import bookPreview from "@/assets/book-preview.jpg";

const ExampleSection = () => {
  return (
    <section id="exempel" className="bg-background py-20 md:py-28">
      <div className="container mx-auto px-4 md:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div className="order-2 lg:order-1">
            <div className="relative">
              <img
                src={bookPreview}
                alt="Exempel på färdig minnesbok med kapitel och foton"
                className="rounded-2xl shadow-xl"
                loading="lazy"
              />
              <div className="absolute bottom-4 left-4 right-4 space-y-2">
                <div className="flex flex-wrap gap-2">
                  {["Mitt barndomshem", "Livet med mina syskon", "Sommaren på landet", "Min första kärlek", "Mormors kök"].map((title) => (
                    <span
                      key={title}
                      className="rounded-full bg-background/85 px-3 py-1 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm md:text-sm"
                    >
                      {title}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="order-1 space-y-6 lg:order-2">
            <h2 className="font-serif text-3xl font-bold text-foreground md:text-4xl">
              En bok fylld med kärlek
            </h2>
            <p className="text-lg leading-relaxed text-muted-foreground">
              Varje bok skapas med omsorg — från professionellt redigerade
              berättelser till restaurerade fotografier. Skanna QR-koderna i
              boken för att höra berättarens röst direkt.
            </p>
            <div className="grid grid-cols-3 gap-4 pt-4">
              <div className="text-center">
                <p className="font-serif text-3xl font-bold text-primary">2 000+</p>
                <p className="text-sm text-muted-foreground">Skapade böcker</p>
              </div>
              <div className="text-center">
                <p className="font-serif text-3xl font-bold text-primary">50 000+</p>
                <p className="text-sm text-muted-foreground">Inspelade minnen</p>
              </div>
              <div className="text-center">
                <p className="font-serif text-3xl font-bold text-primary">4.9 ★</p>
                <p className="text-sm text-muted-foreground">Medelbetyg</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ExampleSection;
