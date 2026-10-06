export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      api_usage_logs: {
        Row: {
          created_at: string
          function_name: string
          id: string
          model: string | null
          request_metadata: Json | null
          tokens_used: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          function_name: string
          id?: string
          model?: string | null
          request_metadata?: Json | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          function_name?: string
          id?: string
          model?: string | null
          request_metadata?: Json | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      books: {
        Row: {
          book_template: string
          created_at: string
          deleted_at: string | null
          deletion_reminded_1d: boolean
          deletion_reminded_1m: boolean
          deletion_reminded_2w: boolean
          description: string | null
          id: string
          image_count: number
          inactivity_reminded_105d: boolean
          inactivity_reminded_115d: boolean
          inactivity_reminded_60d: boolean
          inactivity_reminded_75d: boolean
          inactivity_reminded_90d: boolean
          is_deleted: boolean
          last_edited: string
          page_count: number
          plan_type: string
          print_tier: string | null
          raw_audio_duration: number | null
          raw_audio_url: string | null
          scheduled_deletion: string | null
          status: string
          target_page_count: number | null
          title: string
          transcription_language: string | null
          transcription_status: string | null
          transcription_text: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          book_template?: string
          created_at?: string
          deleted_at?: string | null
          deletion_reminded_1d?: boolean
          deletion_reminded_1m?: boolean
          deletion_reminded_2w?: boolean
          description?: string | null
          id?: string
          image_count?: number
          inactivity_reminded_105d?: boolean
          inactivity_reminded_115d?: boolean
          inactivity_reminded_60d?: boolean
          inactivity_reminded_75d?: boolean
          inactivity_reminded_90d?: boolean
          is_deleted?: boolean
          last_edited?: string
          page_count?: number
          plan_type?: string
          print_tier?: string | null
          raw_audio_duration?: number | null
          raw_audio_url?: string | null
          scheduled_deletion?: string | null
          status?: string
          target_page_count?: number | null
          title?: string
          transcription_language?: string | null
          transcription_status?: string | null
          transcription_text?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          book_template?: string
          created_at?: string
          deleted_at?: string | null
          deletion_reminded_1d?: boolean
          deletion_reminded_1m?: boolean
          deletion_reminded_2w?: boolean
          description?: string | null
          id?: string
          image_count?: number
          inactivity_reminded_105d?: boolean
          inactivity_reminded_115d?: boolean
          inactivity_reminded_60d?: boolean
          inactivity_reminded_75d?: boolean
          inactivity_reminded_90d?: boolean
          is_deleted?: boolean
          last_edited?: string
          page_count?: number
          plan_type?: string
          print_tier?: string | null
          raw_audio_duration?: number | null
          raw_audio_url?: string | null
          scheduled_deletion?: string | null
          status?: string
          target_page_count?: number | null
          title?: string
          transcription_language?: string | null
          transcription_status?: string | null
          transcription_text?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      deleted_books_backup: {
        Row: {
          backup_expires_at: string
          book_data: Json
          created_at: string
          deleted_at: string
          id: string
          original_book_id: string
          restored: boolean
          title: string
          user_id: string
        }
        Insert: {
          backup_expires_at?: string
          book_data: Json
          created_at?: string
          deleted_at?: string
          id?: string
          original_book_id: string
          restored?: boolean
          title: string
          user_id: string
        }
        Update: {
          backup_expires_at?: string
          book_data?: Json
          created_at?: string
          deleted_at?: string
          id?: string
          original_book_id?: string
          restored?: boolean
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      images: {
        Row: {
          book_id: string
          caption: string | null
          created_at: string
          file_size: number | null
          height: number | null
          id: string
          page_id: string | null
          position: number
          thumbnail_url: string | null
          url: string
          width: number | null
        }
        Insert: {
          book_id: string
          caption?: string | null
          created_at?: string
          file_size?: number | null
          height?: number | null
          id?: string
          page_id?: string | null
          position?: number
          thumbnail_url?: string | null
          url: string
          width?: number | null
        }
        Update: {
          book_id?: string
          caption?: string | null
          created_at?: string
          file_size?: number | null
          height?: number | null
          id?: string
          page_id?: string | null
          position?: number
          thumbnail_url?: string | null
          url?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "images_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "images_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_turns: {
        Row: {
          book_id: string
          conversation_history: Json | null
          created_at: string
          id: string
          minna_response: string | null
          question_id: string
          question_text: string
          theme_id: string
          user_answer: string
        }
        Insert: {
          book_id: string
          conversation_history?: Json | null
          created_at?: string
          id?: string
          minna_response?: string | null
          question_id: string
          question_text: string
          theme_id: string
          user_answer: string
        }
        Update: {
          book_id?: string
          conversation_history?: Json | null
          created_at?: string
          id?: string
          minna_response?: string | null
          question_id?: string
          question_text?: string
          theme_id?: string
          user_answer?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_turns_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      invite_codes: {
        Row: {
          active: boolean
          code: string
          created_at: string
          expires_at: string | null
          grants_premium: boolean
          id: string
          max_uses: number | null
          note: string | null
          skip_email_verification: boolean
          used_count: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          expires_at?: string | null
          grants_premium?: boolean
          id?: string
          max_uses?: number | null
          note?: string | null
          skip_email_verification?: boolean
          used_count?: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          expires_at?: string | null
          grants_premium?: boolean
          id?: string
          max_uses?: number | null
          note?: string | null
          skip_email_verification?: boolean
          used_count?: number
        }
        Relationships: []
      }
      invite_redemptions: {
        Row: {
          id: string
          invite_code_id: string
          redeemed_at: string
          user_id: string
        }
        Insert: {
          id?: string
          invite_code_id: string
          redeemed_at?: string
          user_id: string
        }
        Update: {
          id?: string
          invite_code_id?: string
          redeemed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invite_redemptions_invite_code_id_fkey"
            columns: ["invite_code_id"]
            isOneToOne: false
            referencedRelation: "invite_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      minna_config: {
        Row: {
          followup_system_prompt: string
          id: string
          interview_questions: Json
          structure_system_prompt: string
          structure_test_system_prompt: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          followup_system_prompt?: string
          id?: string
          interview_questions?: Json
          structure_system_prompt?: string
          structure_test_system_prompt?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          followup_system_prompt?: string
          id?: string
          interview_questions?: Json
          structure_system_prompt?: string
          structure_test_system_prompt?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      pages: {
        Row: {
          audio_duration: number | null
          audio_url: string | null
          book_id: string
          chapter_number: number | null
          content: string | null
          created_at: string
          end_position: number | null
          id: string
          layout_type: string
          page_number: number
          start_position: number | null
          title: string | null
          updated_at: string
        }
        Insert: {
          audio_duration?: number | null
          audio_url?: string | null
          book_id: string
          chapter_number?: number | null
          content?: string | null
          created_at?: string
          end_position?: number | null
          id?: string
          layout_type?: string
          page_number: number
          start_position?: number | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          audio_duration?: number | null
          audio_url?: string | null
          book_id?: string
          chapter_number?: number | null
          content?: string | null
          created_at?: string
          end_position?: number | null
          id?: string
          layout_type?: string
          page_number?: number
          start_position?: number | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pages_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      print_orders: {
        Row: {
          book_id: string | null
          created_at: string
          id: string
          order_type: string
          price: number | null
          quantity: number
          shipping_address: Json | null
          status: string
          tracking_number: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          book_id?: string | null
          created_at?: string
          id?: string
          order_type: string
          price?: number | null
          quantity?: number
          shipping_address?: Json | null
          status?: string
          tracking_number?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          book_id?: string | null
          created_at?: string
          id?: string
          order_type?: string
          price?: number | null
          quantity?: number
          shipping_address?: Json | null
          status?: string
          tracking_number?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "print_orders_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          birth_year: number | null
          created_at: string
          display_name: string | null
          id: string
          is_demo_premium: boolean
          onboarding_completed: boolean
          relationship: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          birth_year?: number | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_demo_premium?: boolean
          onboarding_completed?: boolean
          relationship?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          birth_year?: number | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_demo_premium?: boolean
          onboarding_completed?: boolean
          relationship?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      stories: {
        Row: {
          content: string | null
          created_at: string
          id: string
          image_url: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          browser_info: string | null
          category: string
          created_at: string
          email: string
          id: string
          message: string
          status: string
          subject: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          browser_info?: string | null
          category: string
          created_at?: string
          email: string
          id?: string
          message: string
          status?: string
          subject: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          browser_info?: string | null
          category?: string
          created_at?: string
          email?: string
          id?: string
          message?: string
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          created_at: string
          deletion_reminders: boolean
          email_notifications: boolean
          inspiration_frequency: string
          newsletter: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          deletion_reminders?: boolean
          email_notifications?: boolean
          inspiration_frequency?: string
          newsletter?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          deletion_reminders?: boolean
          email_notifications?: boolean
          inspiration_frequency?: string
          newsletter?: boolean
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
