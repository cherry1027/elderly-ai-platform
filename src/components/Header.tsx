import { Link, useNavigate, useLocation, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Cog, Tag, BookOpen, Gift, LogIn, FlaskConical, Shield, ArrowLeft } from "lucide-react";
import logoIcon from "@/assets/logo-icon.png";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { useAuth } from "@/contexts/AuthContext";

const Header = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { isAdmin } = useAdminCheck();

  // Detect if we're inside a book context
  const bookMatch = location.pathname.match(/^\/bok\/([^/]+)/);
  const isInBookContext = !!bookMatch;
  const bookId = bookMatch?.[1];

  const scrollToSection = (id: string) => {
    if (location.pathname !== "/") {
      navigate("/", { state: { scrollTo: id } });
      return;
    }
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <header className="bg-primary sticky top-0 z-50 shadow-sm">
      <div className="container mx-auto flex items-center justify-between px-4 py-3 md:px-8">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center">
            <img src={logoIcon} alt="Mina Minnen logotyp" className="h-12 w-auto object-contain" />
          </Link>
          {isInBookContext && (
            <Link
              to={`/bok/${bookId}`}
              className="flex items-center gap-1.5 text-sm font-medium text-primary-foreground/90 hover:text-primary-foreground bg-primary-foreground/10 rounded-full px-3 py-1.5 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Tillbaka till boken
            </Link>
          )}
        </div>

        <nav className="hidden items-center gap-6 md:flex">
          <button
            onClick={() => scrollToSection("hur-det-fungerar")}
            className="flex items-center gap-1.5 cursor-pointer text-sm font-medium text-primary-foreground/90 transition-colors hover:text-primary-foreground"
          >
            <Cog className="h-4 w-4" />
            Hur det fungerar
          </button>
          <button
            onClick={() => scrollToSection("priser")}
            className="flex items-center gap-1.5 cursor-pointer text-sm font-medium text-primary-foreground/90 transition-colors hover:text-primary-foreground"
          >
            <Tag className="h-4 w-4" />
            Priser
          </button>
          <button
            onClick={() => scrollToSection("exempel")}
            className="flex items-center gap-1.5 cursor-pointer text-sm font-medium text-primary-foreground/90 transition-colors hover:text-primary-foreground"
          >
            <BookOpen className="h-4 w-4" />
            Exempel
          </button>
          <Link
            to="/test"
            className="flex items-center gap-1.5 text-sm font-medium text-primary-foreground/90 transition-colors hover:text-primary-foreground"
          >
            <FlaskConical className="h-4 w-4" />
            Testa nu
          </Link>
          <Link
            to="/presentkort"
            className="flex items-center gap-1.5 text-sm font-medium text-primary-foreground/90 transition-colors hover:text-primary-foreground"
          >
            <Gift className="h-4 w-4" />
            Ge den bästa gåvan
          </Link>
          {isAdmin && (
            <Link
              to="/admin"
              className="flex items-center gap-1.5 text-sm font-medium text-primary-foreground/90 transition-colors hover:text-primary-foreground"
            >
              <Shield className="h-4 w-4" />
              Admin
            </Link>
          )}
          {user ? (
            <Link
              to="/dashboard"
              className="flex items-center gap-1.5 text-sm font-medium text-primary-foreground/90 transition-colors hover:text-primary-foreground"
            >
              <LogIn className="h-4 w-4" />
              Mina berättelser
            </Link>
          ) : (
            <Link
              to="/logga-in"
              className="flex items-center gap-1.5 text-sm font-medium text-primary-foreground/90 transition-colors hover:text-primary-foreground"
            >
              <LogIn className="h-4 w-4" />
              Logga in
            </Link>
          )}
        </nav>

        <Button
          variant="cta"
          size="lg"
          className="hidden cursor-pointer md:inline-flex"
          onClick={() => navigate("/test")}
        >
          Kom igång
        </Button>

        {/* Mobile menu button */}
        <button className="text-primary-foreground md:hidden" aria-label="Meny">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>
    </header>
  );
};

export default Header;
