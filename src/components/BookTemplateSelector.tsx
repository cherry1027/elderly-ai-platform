import { Check } from "lucide-react";

export type BookTemplate = "classic" | "modern" | "vintage" | "nature" | "elegant";

interface TemplateOption {
  id: BookTemplate;
  name: string;
  description: string;
  preview: {
    headerBg: string;
    bodyBg: string;
    titleFont: string;
    accentColor: string;
  };
}

const templates: TemplateOption[] = [
  {
    id: "classic",
    name: "Klassisk",
    description: "Tidlös design med serifer och varma toner",
    preview: { headerBg: "bg-primary", bodyBg: "bg-card", titleFont: "font-serif", accentColor: "border-primary" },
  },
  {
    id: "modern",
    name: "Modern",
    description: "Ren och minimalistisk med sans-serif",
    preview: { headerBg: "bg-foreground", bodyBg: "bg-background", titleFont: "font-sans", accentColor: "border-foreground" },
  },
  {
    id: "vintage",
    name: "Retro",
    description: "Nostalgisk stil med sepia-toner",
    preview: { headerBg: "bg-[hsl(30,40%,35%)]", bodyBg: "bg-[hsl(38,35%,90%)]", titleFont: "font-serif italic", accentColor: "border-[hsl(30,40%,35%)]" },
  },
  {
    id: "nature",
    name: "Natur",
    description: "Lugna gröna toner med organisk känsla",
    preview: { headerBg: "bg-secondary", bodyBg: "bg-[hsl(140,15%,95%)]", titleFont: "font-serif", accentColor: "border-secondary" },
  },
  {
    id: "elegant",
    name: "Elegant",
    description: "Sofistikerad med guld-accenter",
    preview: { headerBg: "bg-[hsl(45,30%,25%)]", bodyBg: "bg-[hsl(45,20%,96%)]", titleFont: "font-serif", accentColor: "border-[hsl(45,60%,50%)]" },
  },
];

interface BookTemplateSelectorProps {
  selected: BookTemplate;
  onSelect: (template: BookTemplate) => void;
  disabled?: boolean;
}

export default function BookTemplateSelector({ selected, onSelect, disabled }: BookTemplateSelectorProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      {templates.map((t) => {
        const isActive = selected === t.id;
        return (
          <button
            key={t.id}
            onClick={() => !disabled && onSelect(t.id)}
            disabled={disabled}
            className={`relative rounded-xl border-2 overflow-hidden transition-all text-left ${
              isActive ? `${t.preview.accentColor} ring-2 ring-offset-2 ring-primary shadow-lg` : "border-border hover:border-muted-foreground/40"
            } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
          >
            {/* Mini preview */}
            <div className="aspect-[148/210] flex flex-col">
              <div className={`${t.preview.headerBg} px-3 py-2`}>
                <div className="h-2 w-12 bg-white/40 rounded" />
                <div className="h-1.5 w-8 bg-white/25 rounded mt-1" />
              </div>
              <div className={`${t.preview.bodyBg} flex-1 p-3 space-y-1.5`}>
                <div className="h-1.5 w-14 bg-foreground/15 rounded" />
                <div className="h-1 w-full bg-foreground/8 rounded" />
                <div className="h-1 w-full bg-foreground/8 rounded" />
                <div className="h-1 w-3/4 bg-foreground/8 rounded" />
                <div className="mt-2 h-8 w-full bg-foreground/5 rounded" />
              </div>
            </div>

            {/* Label */}
            <div className="p-2 bg-card border-t border-border">
              <p className={`text-sm font-medium text-foreground ${t.preview.titleFont}`}>{t.name}</p>
              <p className="text-[10px] text-muted-foreground leading-tight">{t.description}</p>
            </div>

            {isActive && (
              <div className="absolute top-2 right-2 w-5 h-5 bg-primary text-primary-foreground rounded-full flex items-center justify-center">
                <Check className="w-3 h-3" />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

// Template style configs for rendering
export const templateStyles: Record<BookTemplate, {
  headerBg: string;
  headerText: string;
  bodyBg: string;
  titleClass: string;
  bodyTextClass: string;
  accentBorder: string;
  imageBorder: string;
  pageNumberClass: string;
}> = {
  classic: {
    headerBg: "bg-primary",
    headerText: "text-primary-foreground",
    bodyBg: "bg-card",
    titleClass: "font-serif text-foreground",
    bodyTextClass: "text-foreground leading-relaxed",
    accentBorder: "border-primary/30",
    imageBorder: "rounded-lg shadow-md",
    pageNumberClass: "text-muted-foreground",
  },
  modern: {
    headerBg: "bg-foreground",
    headerText: "text-background",
    bodyBg: "bg-background",
    titleClass: "font-sans font-bold tracking-tight text-foreground",
    bodyTextClass: "text-foreground/80 leading-loose font-light",
    accentBorder: "border-foreground/20",
    imageBorder: "rounded-none shadow-lg",
    pageNumberClass: "text-foreground/40 font-mono",
  },
  vintage: {
    headerBg: "bg-[hsl(30,40%,35%)]",
    headerText: "text-[hsl(38,35%,90%)]",
    bodyBg: "bg-[hsl(38,35%,90%)]",
    titleClass: "font-serif italic text-[hsl(30,40%,25%)]",
    bodyTextClass: "text-[hsl(30,20%,30%)] leading-relaxed",
    accentBorder: "border-[hsl(30,30%,60%)]",
    imageBorder: "rounded-sm shadow-md border-4 border-[hsl(38,30%,85%)]",
    pageNumberClass: "text-[hsl(30,20%,50%)] italic",
  },
  nature: {
    headerBg: "bg-secondary",
    headerText: "text-secondary-foreground",
    bodyBg: "bg-[hsl(140,15%,95%)]",
    titleClass: "font-serif text-secondary",
    bodyTextClass: "text-[hsl(140,10%,25%)] leading-relaxed",
    accentBorder: "border-secondary/30",
    imageBorder: "rounded-xl shadow-sm",
    pageNumberClass: "text-secondary/50",
  },
  elegant: {
    headerBg: "bg-[hsl(45,30%,25%)]",
    headerText: "text-[hsl(45,60%,80%)]",
    bodyBg: "bg-[hsl(45,20%,96%)]",
    titleClass: "font-serif tracking-wide text-[hsl(45,30%,20%)]",
    bodyTextClass: "text-[hsl(45,15%,30%)] leading-relaxed",
    accentBorder: "border-[hsl(45,60%,50%)]/30",
    imageBorder: "rounded-md shadow-lg border border-[hsl(45,40%,80%)]",
    pageNumberClass: "text-[hsl(45,30%,55%)]",
  },
};
