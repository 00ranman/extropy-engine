import { Link, useLocation } from "wouter";
import { Moon, Sun, FileText, LayoutDashboard, Trophy, Award, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { useState, useEffect, type ReactNode } from "react";

// SVG Logo: Stylized "A" with upward arrow — knowledge growth
function AcademicXPLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="AcademicXP logo"
    >
      {/* Upward arrow integrated into letter A */}
      <path
        d="M16 2L10 18h4v10h4V18h4L16 2z"
        fill="currentColor"
        opacity="0.9"
      />
      {/* Crossbar of A */}
      <rect x="11" y="14" width="10" height="2" rx="1" fill="currentColor" opacity="0.5" />
      {/* Base platform */}
      <rect x="6" y="28" width="20" height="2" rx="1" fill="currentColor" opacity="0.3" />
    </svg>
  );
}

const navItems = [
  { href: "/", label: "Upload", icon: Upload },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/credentials", label: "Credentials", icon: Award },
];

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [dark, setDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Top nav bar */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="max-w-7xl mx-auto flex items-center justify-between h-12 px-4">
          {/* Logo + brand */}
          <Link href="/" className="flex items-center gap-2 text-primary hover:opacity-80 transition-opacity">
            <AcademicXPLogo className="w-6 h-6" />
            <span className="font-serif font-semibold text-base tracking-tight">
              AcademicXP
            </span>
          </Link>

          {/* Nav links */}
          <nav className="flex items-center gap-1">
            {navItems.map(({ href, label, icon: Icon }) => {
              const isActive = location === href || (href !== "/" && location.startsWith(href));
              return (
                <Tooltip key={href}>
                  <TooltipTrigger asChild>
                    <Link href={href}>
                      <Button
                        variant={isActive ? "secondary" : "ghost"}
                        size="sm"
                        className={`gap-1.5 text-xs font-medium ${isActive ? "text-primary" : "text-muted-foreground"}`}
                        data-testid={`nav-${label.toLowerCase()}`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">{label}</span>
                      </Button>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="sm:hidden">
                    {label}
                  </TooltipContent>
                </Tooltip>
              );
            })}

            {/* Manuscript icon for quick nav */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="/manuscript/ms-001">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-xs font-medium text-muted-foreground"
                    data-testid="nav-manuscript"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Review</span>
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="bottom">Manuscript Review</TooltipContent>
            </Tooltip>

            {/* Dark mode toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDark(!dark)}
              className="ml-1 w-8 h-8 p-0"
              data-testid="button-theme-toggle"
              aria-label="Toggle dark mode"
            >
              {dark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </Button>
          </nav>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1">
        {children}
      </main>

      {/* Footer */}
      <PerplexityAttribution />
    </div>
  );
}
