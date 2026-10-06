import { Link } from "react-router-dom";
import logoIcon from "@/assets/logo-icon.png";

const Footer = () => {
  return (
    <footer className="bg-foreground py-12 text-background/80">
      <div className="container mx-auto px-4 md:px-8">
        <div className="grid gap-8 md:grid-cols-4">
          <div>
            <Link to="/" className="flex items-center">
              <img src={logoIcon} alt="Mina Minnen logotyp" className="h-12 w-auto object-contain" />
            </Link>
            <p className="mt-3 text-sm leading-relaxed text-background/60">
              Vi hjälper svenska familjer att bevara sina minnen för kommande generationer.
            </p>
          </div>

          <div>
            <h4 className="mb-3 font-serif text-sm font-semibold text-background">Tjänster</h4>
            <ul className="space-y-2 text-sm text-background/60">
              <li><a href="#" className="hover:text-background transition-colors">Skapa minnesbok</a></li>
              <li><a href="#" className="hover:text-background transition-colors">Röstinspelning</a></li>
              <li><a href="#" className="hover:text-background transition-colors">Fotorestaurering</a></li>
              <li><a href="#" className="hover:text-background transition-colors">Presentkort</a></li>
            </ul>
          </div>

          <div>
            <h4 className="mb-3 font-serif text-sm font-semibold text-background">Företag</h4>
            <ul className="space-y-2 text-sm text-background/60">
              <li><a href="#" className="hover:text-background transition-colors">Om oss</a></li>
              <li><a href="#" className="hover:text-background transition-colors">Blogg</a></li>
              <li><a href="#" className="hover:text-background transition-colors">Kontakt</a></li>
              <li><a href="#" className="hover:text-background transition-colors">Karriär</a></li>
            </ul>
          </div>

          <div>
            <h4 className="mb-3 font-serif text-sm font-semibold text-background">Juridik</h4>
            <ul className="space-y-2 text-sm text-background/60">
              <li><a href="#" className="hover:text-background transition-colors">Integritetspolicy</a></li>
              <li><a href="#" className="hover:text-background transition-colors">Användarvillkor</a></li>
              <li><a href="#" className="hover:text-background transition-colors">GDPR</a></li>
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-background/10 pt-6 text-center text-xs text-background/40">
          © {new Date().getFullYear()} Mina Minnen — Alla rättigheter förbehållna
        </div>
      </div>
    </footer>
  );
};

export default Footer;
