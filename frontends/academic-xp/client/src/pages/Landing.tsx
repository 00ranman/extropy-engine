import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { Upload, Brain, Zap, Atom, FileText, CheckCircle, AlertCircle, X, Users, BarChart3, Target } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { mockPlatformStats } from "@/lib/mockData";

type UploadState = "idle" | "dragging" | "uploading" | "success" | "error";

export default function Landing() {
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [fileName, setFileName] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [, navigate] = useLocation();

  const validateFile = (file: File): string | null => {
    if (file.type !== "application/pdf") return "Only PDF files are accepted.";
    if (file.size > 50 * 1024 * 1024) return "File must be under 50MB.";
    return null;
  };

  const simulateUpload = useCallback((file: File) => {
    setFileName(file.name);
    setUploadState("uploading");
    setProgress(0);

    let current = 0;
    const interval = setInterval(() => {
      current += Math.random() * 15 + 5;
      if (current >= 100) {
        current = 100;
        clearInterval(interval);
        setProgress(100);
        setTimeout(() => {
          setUploadState("success");
          // Navigate to the first mock manuscript after success
          setTimeout(() => navigate("/manuscript/ms-001"), 1500);
        }, 400);
      }
      setProgress(Math.round(current));
    }, 200);
  }, [navigate]);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const error = validateFile(file);
    if (error) {
      setErrorMessage(error);
      setUploadState("error");
      return;
    }
    simulateUpload(file);
  }, [simulateUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setUploadState("dragging");
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setUploadState("idle");
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const resetUpload = () => {
    setUploadState("idle");
    setProgress(0);
    setFileName("");
    setErrorMessage("");
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-10">
      {/* Hero */}
      <section className="text-center space-y-3">
        <h1 className="font-serif font-bold text-xl text-foreground tracking-tight">
          Peer Review, Reimagined
        </h1>
        <p className="text-sm text-muted-foreground max-w-xl mx-auto leading-relaxed">
          Entropy-anchored validation with AI pre-screening, transparent XP rewards,
          and thermodynamic consensus. Submit your manuscript and experience
          peer review that&apos;s rigorous, fair, and verifiable.
        </p>
      </section>

      {/* Upload Zone */}
      <section className="max-w-2xl mx-auto">
        <div
          className={`
            relative rounded-lg border-2 border-dashed transition-all duration-200 cursor-pointer
            ${uploadState === "dragging"
              ? "border-primary bg-primary/5 scale-[1.01]"
              : uploadState === "uploading"
              ? "border-primary/40 bg-primary/5"
              : uploadState === "success"
              ? "border-green-500 bg-green-500/5"
              : uploadState === "error"
              ? "border-destructive bg-destructive/5"
              : "border-border hover:border-primary/40 hover:bg-muted/50"
            }
          `}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => uploadState === "idle" && fileInputRef.current?.click()}
          data-testid="upload-zone"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
            data-testid="input-file"
          />

          <div className="flex flex-col items-center justify-center py-12 px-6">
            {uploadState === "idle" || uploadState === "dragging" ? (
              <>
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <Upload className="w-5 h-5 text-primary" />
                </div>
                <p className="text-sm font-medium text-foreground mb-1">
                  {uploadState === "dragging" ? "Drop your PDF here" : "Drag & drop your manuscript"}
                </p>
                <p className="text-xs text-muted-foreground mb-3">
                  PDF format, up to 50MB
                </p>
                <Button variant="outline" size="sm" className="text-xs" data-testid="button-browse">
                  Browse files
                </Button>
              </>
            ) : uploadState === "uploading" ? (
              <>
                <FileText className="w-8 h-8 text-primary mb-3 animate-pulse" />
                <p className="text-sm font-medium text-foreground mb-1">{fileName}</p>
                <div className="w-full max-w-xs mb-2">
                  <Progress value={progress} className="h-1.5" />
                </div>
                <p className="text-xs text-muted-foreground">
                  {progress < 30 ? "Uploading..." : progress < 70 ? "Processing..." : "Running AI pre-review..."}
                </p>
              </>
            ) : uploadState === "success" ? (
              <>
                <CheckCircle className="w-8 h-8 text-green-500 mb-3" />
                <p className="text-sm font-medium text-foreground mb-1">Upload complete</p>
                <p className="text-xs text-muted-foreground">
                  AI pre-review generated. Redirecting to manuscript view...
                </p>
              </>
            ) : uploadState === "error" ? (
              <>
                <AlertCircle className="w-8 h-8 text-destructive mb-3" />
                <p className="text-sm font-medium text-foreground mb-1">{errorMessage}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs mt-2"
                  onClick={(e) => { e.stopPropagation(); resetUpload(); }}
                  data-testid="button-retry"
                >
                  <X className="w-3 h-3 mr-1" /> Try again
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </section>

      {/* Feature Cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <FeatureCard
          icon={<Brain className="w-4 h-4" />}
          title="AI Pre-Review"
          description="Every manuscript receives instant AI analysis — technical accuracy, methodology, novelty, and reproducibility scores before human review begins."
          badge="98.7% accuracy"
        />
        <FeatureCard
          icon={<Zap className="w-4 h-4" />}
          title="XP Rewards"
          description="Earn experience points for quality reviews. Progress through tiers from Novice to Pioneer with verifiable, exportable credentials."
          badge="Nash equilibrium"
        />
        <FeatureCard
          icon={<Atom className="w-4 h-4" />}
          title="Thermodynamic Anchoring"
          description="Reviews anchored to entropy reduction metrics ensure honest evaluation. Gaming the system yields negative expected utility."
          badge="91% consensus"
        />
      </section>

      {/* Stats Bar */}
      <section className="flex items-center justify-center gap-8 py-4 border-t border-b border-border">
        <StatItem icon={<FileText className="w-3.5 h-3.5" />} value={mockPlatformStats.totalManuscripts.toLocaleString()} label="Manuscripts" />
        <StatItem icon={<Users className="w-3.5 h-3.5" />} value={mockPlatformStats.activeReviewers.toLocaleString()} label="Reviewers" />
        <StatItem icon={<Target className="w-3.5 h-3.5" />} value={`${mockPlatformStats.consensusRate}%`} label="Consensus" />
        <StatItem icon={<BarChart3 className="w-3.5 h-3.5" />} value={`${mockPlatformStats.avgSatisfaction}/5.0`} label="Satisfaction" />
      </section>
    </div>
  );
}

function FeatureCard({ icon, title, description, badge }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge: string;
}) {
  return (
    <Card className="hover-elevate relative" data-testid={`card-feature-${title.toLowerCase().replace(/\s/g, "-")}`}>
      <CardContent className="pt-5 pb-4 px-4 space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center text-primary">
            {icon}
          </div>
          <h3 className="font-sans font-semibold text-sm text-foreground">{title}</h3>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        <Badge variant="secondary" className="text-[10px]">{badge}</Badge>
      </CardContent>
    </Card>
  );
}

function StatItem({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-center" data-testid={`stat-${label.toLowerCase()}`}>
      <span className="text-muted-foreground">{icon}</span>
      <div>
        <p className="text-sm font-semibold text-foreground font-mono">{value}</p>
        <p className="text-[10px] text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
