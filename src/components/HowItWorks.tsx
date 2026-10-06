import { BookOpen, Sparkles, Heart, Users } from "lucide-react";

const features = [
  {
    icon: BookOpen,
    title: "Professionell redigering",
    description:
      "Du pratar in din historia och AI omvandlar din berättelse till en vackert formaterad bok med professionell layout och design.",
  },
  {
    icon: Sparkles,
    title: "AI-förbättrade foton",
    description:
      "Återställ och färglägg gamla fotografier med hjälp av AI-teknik för tidlösa minnen.",
  },
  {
    icon: Heart,
    title: "Minnesskatt för evigt",
    description:
      "Skapa en tidlös samling som kan delas med generationer framöver.",
  },
  {
    icon: Users,
    title: "Perfekt för hela familjen",
    description:
      "Samla berättelser från alla familjemedlemmar och skapa en komplett familjehistoria.",
  },
];

const HowItWorks = () => {
  return (
    <section id="hur-det-fungerar" className="bg-background py-20 md:py-28">
      <div className="container mx-auto px-4 md:px-8">
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <h2 className="font-serif text-3xl font-bold text-foreground md:text-4xl">
            Hur det fungerar
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Vi gör det enkelt att bevara och dela dina familjeberättelser
          </p>
        </div>

        <div className="grid gap-8 sm:grid-cols-2 lg:gap-12">
          {features.map((feature, index) => (
            <div
              key={index}
              className="group rounded-2xl bg-card p-8 shadow-sm transition-all duration-300 hover:shadow-md hover:-translate-y-1"
            >
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <feature.icon className="h-7 w-7" />
              </div>
              <h3 className="mb-3 font-serif text-xl font-semibold text-card-foreground">
                {feature.title}
              </h3>
              <p className="leading-relaxed text-muted-foreground">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;
