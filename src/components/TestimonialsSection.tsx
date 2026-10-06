const testimonials = [
  {
    quote: "Min mamma fyllde 80 och vi gav henne boken som present. Hon grät av glädje.",
    name: "Anna L.",
    role: "Dotter",
    emoji: "💐",
  },
  {
    quote: "Otroligt enkelt. Pappa pratade i 20 minuter och det blev ett helt kapitel.",
    name: "Erik S.",
    role: "Son",
    emoji: "🎙️",
  },
  {
    quote: "Jag visste inte att farmors berättelser kunde bli så vackra i bokform.",
    name: "Lisa K.",
    role: "Barnbarn",
    emoji: "📖",
  },
];

const TestimonialsSection = () => {
  return (
    <section className="bg-background py-20 md:py-28">
      <div className="container mx-auto px-4 md:px-8">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="font-serif text-3xl font-bold text-foreground md:text-4xl">
            Vad andra säger
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Familjer som redan bevarat sina minnen
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3 max-w-4xl mx-auto">
          {testimonials.map((t, i) => (
            <div
              key={i}
              className="rounded-2xl bg-card border border-border p-6 shadow-sm hover:shadow-md transition-shadow"
            >
              <p className="text-2xl mb-4">{t.emoji}</p>
              <p className="text-foreground leading-relaxed mb-4 italic">
                "{t.quote}"
              </p>
              <div>
                <p className="text-sm font-semibold text-foreground">{t.name}</p>
                <p className="text-xs text-muted-foreground">{t.role}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TestimonialsSection;
