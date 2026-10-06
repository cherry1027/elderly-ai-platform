import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Del 8: Inactivity-based deletion for freemium users
 * 
 * Timeline (from last activity / last_edited):
 *   Day 60  → First warning
 *   Day 75  → Second warning
 *   Day 90  → Third warning (urgent)
 *   Day 105 → Fourth warning
 *   Day 115 → Last chance
 *   Day 120 → Automatic deletion (backup kept 30 days)
 * 
 * After deletion, backup is stored in deleted_books_backup for 30 days.
 * Expired backups are permanently purged.
 */

interface ReminderStage {
  days: number;
  column: string;
  subject: string;
  urgency: "info" | "warning" | "urgent" | "critical";
}

const REMINDER_STAGES: ReminderStage[] = [
  { days: 60, column: "inactivity_reminded_60d", subject: "Vi saknar dig! Din bok finns kvar.", urgency: "info" },
  { days: 75, column: "inactivity_reminded_75d", subject: "Din bok raderas om 45 dagar", urgency: "warning" },
  { days: 90, column: "inactivity_reminded_90d", subject: "VIKTIG INFO: Din bok raderas snart", urgency: "urgent" },
  { days: 105, column: "inactivity_reminded_105d", subject: "15 dagar kvar – logga in för att behålla din bok", urgency: "critical" },
  { days: 115, column: "inactivity_reminded_115d", subject: "5 DAGAR KVAR – Gör något nu!", urgency: "critical" },
];

const DELETION_DAY = 120;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const now = new Date();
    const stats = { reminders: {} as Record<string, number>, deleted: 0, backupsPurged: 0 };

    // ========== INACTIVITY REMINDERS ==========
    // Only target freemium books that are not deleted
    for (const stage of REMINDER_STAGES) {
      const cutoffDate = new Date(now);
      cutoffDate.setDate(cutoffDate.getDate() - stage.days);

      const { data: books } = await supabase
        .from("books")
        .select("id, title, user_id, last_edited, page_count, image_count")
        .eq("plan_type", "freemium")
        .eq("is_deleted", false)
        .eq(stage.column, false)
        .lte("last_edited", cutoffDate.toISOString());

      let count = 0;
      for (const book of books || []) {
        const { data: userData } = await supabase.auth.admin.getUserById(book.user_id);
        const email = userData?.user?.email;
        const daysInactive = Math.floor((now.getTime() - new Date(book.last_edited).getTime()) / (1000 * 60 * 60 * 24));
        const daysUntilDeletion = Math.max(0, DELETION_DAY - daysInactive);

        console.log(
          `[${stage.urgency.toUpperCase()}] ${stage.column}: ${email || "unknown"} - "${book.title}" ` +
          `(${daysInactive} days inactive, ${daysUntilDeletion} days until deletion)`
        );

        // TODO: Send email when email service is configured
        // Email content should include:
        // - Book title, page count, image count
        // - Days until deletion
        // - CTA: Login link, Upgrade link, Export PDF link

        await supabase
          .from("books")
          .update({ [stage.column]: true })
          .eq("id", book.id);

        count++;
      }
      stats.reminders[stage.column] = count;
    }

    // ========== AUTOMATIC DELETION (DAY 120) ==========
    const deletionCutoff = new Date(now);
    deletionCutoff.setDate(deletionCutoff.getDate() - DELETION_DAY);

    const { data: booksToDelete } = await supabase
      .from("books")
      .select("id, title, description, user_id, plan_type, page_count, image_count, book_template, last_edited, created_at, pages(id, audio_url, content, title, page_number, layout_type, images(id, url, caption))")
      .eq("plan_type", "freemium")
      .eq("is_deleted", false)
      .lte("last_edited", deletionCutoff.toISOString());

    for (const book of booksToDelete || []) {
      // 1. Create backup (stores full book data as JSON for 30-day recovery)
      const bookBackup = {
        title: book.title,
        description: book.description,
        plan_type: book.plan_type,
        page_count: book.page_count,
        image_count: book.image_count,
        book_template: book.book_template,
        created_at: book.created_at,
        last_edited: book.last_edited,
        pages: book.pages,
      };

      await supabase.from("deleted_books_backup").insert({
        original_book_id: book.id,
        user_id: book.user_id,
        title: book.title,
        book_data: bookBackup,
      });

      // 2. Delete storage files
      for (const page of book.pages || []) {
        if (page.audio_url) {
          await supabase.storage.from("book-audio").remove([page.audio_url]);
        }
        for (const image of (page as any).images || []) {
          const parts = image.url.split("/book-images/");
          if (parts[1]) {
            await supabase.storage.from("book-images").remove([decodeURIComponent(parts[1])]);
          }
        }
      }

      // 3. Delete book (pages/images cascade via FK)
      await supabase.from("books").delete().eq("id", book.id);

      // 4. Notify user
      const { data: userData } = await supabase.auth.admin.getUserById(book.user_id);
      console.log(
        `[DELETED] Book "${book.title}" by ${userData?.user?.email || "unknown"} ` +
        `- backup available for 30 days`
      );

      // TODO: Send deletion confirmation email with:
      // - Book title
      // - "Backup available for 30 days, contact support@minaminnen.se"
      // - CTA: Create new account / Upgrade to Premium

      stats.deleted++;
    }

    // ========== PURGE EXPIRED BACKUPS (30 days after deletion) ==========
    const { data: expiredBackups } = await supabase
      .from("deleted_books_backup")
      .select("id, title, user_id")
      .eq("restored", false)
      .lte("backup_expires_at", now.toISOString());

    for (const backup of expiredBackups || []) {
      await supabase.from("deleted_books_backup").delete().eq("id", backup.id);
      console.log(`[PURGED] Backup for "${backup.title}" permanently removed`);
      stats.backupsPurged++;
    }

    // ========== ALSO HANDLE LEGACY scheduled_deletion ==========
    // Keep backward compat with any books that have scheduled_deletion set
    const { data: legacyExpired } = await supabase
      .from("books")
      .select("id, title, user_id, pages(id, audio_url, images(id, url))")
      .eq("is_deleted", false)
      .not("scheduled_deletion", "is", null)
      .lte("scheduled_deletion", now.toISOString());

    for (const book of legacyExpired || []) {
      for (const page of book.pages || []) {
        if (page.audio_url) {
          await supabase.storage.from("book-audio").remove([page.audio_url]);
        }
        for (const image of (page as any).images || []) {
          const parts = image.url.split("/book-images/");
          if (parts[1]) {
            await supabase.storage.from("book-images").remove([decodeURIComponent(parts[1])]);
          }
        }
      }
      await supabase.from("books").delete().eq("id", book.id);
      stats.deleted++;
    }

    return new Response(
      JSON.stringify({ success: true, ...stats }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in deletion reminders:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
