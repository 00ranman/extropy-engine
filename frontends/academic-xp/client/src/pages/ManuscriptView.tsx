import { useState } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  FileText, Brain, CheckCircle, AlertTriangle, ShieldCheck, Beaker,
  Lightbulb, RotateCcw, Send, User, Calendar, Atom, BarChart3
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fetchManuscript, submitReview } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import type { Manuscript } from "@/lib/mockData";

const statusLabels: Record<string, { label: string; color: string }> = {
  submitted: { label: "Submitted", color: "bg-muted text-muted-foreground" },
  ai_review: { label: "AI Review", color: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  peer_review: { label: "Peer Review", color: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  consensus: { label: "Consensus", color: "bg-green-500/10 text-green-600 dark:text-green-400" },
  published: { label: "Published", color: "bg-primary/10 text-primary" },
  rejected: { label: "Rejected", color: "bg-destructive/10 text-destructive" },
};

export default function ManuscriptView() {
  const [, params] = useRoute("/manuscript/:id");
  const manuscriptId = params?.id ?? "ms-001";

  const { data: manuscript, isLoading } = useQuery<Manuscript | undefined>({
    queryKey: ["/api/manuscripts", manuscriptId],
    queryFn: () => fetchManuscript(manuscriptId),
  });

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8 flex items-center justify-center">
        <div className="animate-pulse text-sm text-muted-foreground">Loading manuscript...</div>
      </div>
    );
  }

  if (!manuscript) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8 text-center">
        <p className="text-sm text-muted-foreground">Manuscript not found.</p>
      </div>
    );
  }

  const status = statusLabels[manuscript.status] ?? statusLabels.submitted;
  const ai = manuscript.aiPreReview;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      {/* Manuscript Header */}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="font-serif font-bold text-lg text-foreground leading-tight">
              {manuscript.title}
            </h1>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <User className="w-3 h-3" />
                {manuscript.authors.join(", ")}
              </span>
              <span className="flex items-center gap-1">
                <Atom className="w-3 h-3" />
                {manuscript.domain}
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {new Date(manuscript.submittedAt).toLocaleDateString("en-US", {
                  year: "numeric", month: "short", day: "numeric",
                })}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge className={`text-[10px] ${status.color}`}>{status.label}</Badge>
            {manuscript.fidelityScore > 0 && (
              <Tooltip>
                <TooltipTrigger>
                  <Badge variant="outline" className="text-[10px] font-mono">
                    <BarChart3 className="w-3 h-3 mr-1" />
                    {(manuscript.fidelityScore * 100).toFixed(0)}% fidelity
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>Thermodynamic fidelity score</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        {/* Abstract */}
        <Card>
          <CardContent className="pt-3 pb-3 px-4">
            <p className="text-xs leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">Abstract: </span>
              {manuscript.abstract}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: AI Pre-Review */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                <Brain className="w-3.5 h-3.5 text-primary" />
                AI Pre-Review
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-4">
              {ai ? (
                <>
                  {/* Score bars */}
                  <div className="space-y-2.5">
                    <ScoreBar label="Technical Accuracy" value={ai.technicalAccuracy} icon={<ShieldCheck className="w-3 h-3" />} />
                    <ScoreBar label="Methodology" value={ai.methodology} icon={<Beaker className="w-3 h-3" />} />
                    <ScoreBar label="Novelty" value={ai.novelty} icon={<Lightbulb className="w-3 h-3" />} />
                    <ScoreBar label="Reproducibility" value={ai.reproducibility} icon={<RotateCcw className="w-3 h-3" />} />
                  </div>

                  {/* Overall score */}
                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <span className="text-xs font-semibold text-foreground">Overall Score</span>
                    <span className="text-lg font-bold font-mono text-primary">{ai.overallScore}</span>
                  </div>

                  {/* Summary */}
                  <p className="text-xs text-muted-foreground leading-relaxed">{ai.summary}</p>

                  {/* Strengths */}
                  <div>
                    <p className="text-[10px] font-semibold text-green-600 dark:text-green-400 uppercase tracking-wider mb-1.5">
                      Strengths
                    </p>
                    <ul className="space-y-1">
                      {ai.strengths.map((s, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <CheckCircle className="w-3 h-3 text-green-500 shrink-0 mt-0.5" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Weaknesses */}
                  <div>
                    <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-1.5">
                      Weaknesses
                    </p>
                    <ul className="space-y-1">
                      {ai.weaknesses.map((w, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                          {w}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Integrity checks */}
                  <div className="flex gap-3 pt-2 border-t border-border">
                    <IntegrityBadge label="Plagiarism" score={ai.plagiarismCheck.score} status={ai.plagiarismCheck.status} />
                    <IntegrityBadge label="Fraud Detection" score={ai.fraudDetection.score} status={ai.fraudDetection.status} />
                  </div>
                </>
              ) : (
                <div className="py-8 text-center">
                  <Brain className="w-8 h-8 text-muted-foreground mx-auto mb-2 animate-pulse" />
                  <p className="text-xs text-muted-foreground">AI pre-review in progress...</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Human Review Form */}
        <div>
          <ReviewForm manuscriptId={manuscript.id} />
        </div>
      </div>

      {/* Consensus Status */}
      {manuscript.status === "consensus" && (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="pt-3 pb-3 px-4 flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-500" />
            <div>
              <p className="text-sm font-semibold text-foreground">Consensus Achieved</p>
              <p className="text-xs text-muted-foreground">
                3 out of 3 reviewers agree on the evaluation. Entropy reduction: 0.42 bits.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Score Bar ─────────────────────────────────────────────────

function ScoreBar({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  const color = value >= 90 ? "text-green-600 dark:text-green-400" : value >= 75 ? "text-amber-600 dark:text-amber-400" : "text-destructive";
  return (
    <div className="space-y-1" data-testid={`score-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
          {icon} {label}
        </span>
        <span className={`text-xs font-mono font-semibold ${color}`}>{value}</span>
      </div>
      <Progress value={value} className="h-1" />
    </div>
  );
}

// ─── Integrity Badge ──────────────────────────────────────────

function IntegrityBadge({ label, score, status }: { label: string; score: number; status: string }) {
  return (
    <div className="flex-1 rounded-md bg-muted/50 px-3 py-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1.5 mt-0.5">
        {status === "clear" ? (
          <CheckCircle className="w-3 h-3 text-green-500" />
        ) : (
          <AlertTriangle className="w-3 h-3 text-destructive" />
        )}
        <span className="text-xs font-mono font-semibold">{score}%</span>
        <span className="text-[10px] text-muted-foreground capitalize">{status}</span>
      </div>
    </div>
  );
}

// ─── Review Form ──────────────────────────────────────────────

function ReviewForm({ manuscriptId }: { manuscriptId: string }) {
  const { toast } = useToast();
  const [ratings, setRatings] = useState({
    technicalAccuracy: 80,
    methodology: 80,
    novelty: 75,
    reproducibility: 75,
  });
  const [strengths, setStrengths] = useState("");
  const [weaknesses, setWeaknesses] = useState("");
  const [suggestions, setSuggestions] = useState("");
  const [baseline, setBaseline] = useState("");
  const [expectedOutcome, setExpectedOutcome] = useState("");
  const [measurementMethod, setMeasurementMethod] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const result = await submitReview({
        manuscriptId,
        ratings,
        strengths,
        weaknesses,
        suggestions,
        thermodynamicAnchor: baseline ? { baseline, expectedOutcome, measurementMethod } : undefined,
      });
      toast({
        title: "Review submitted",
        description: `Earned ${result.xpEarned} XP for this review.`,
      });
    } catch {
      toast({
        title: "Review submitted (demo)",
        description: "Earned 420 XP for this review.",
      });
    }
    setSubmitting(false);
  };

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-primary" />
          Submit Your Review
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Rating sliders */}
          <div className="space-y-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Rating Dimensions
            </p>
            {Object.entries(ratings).map(([key, value]) => (
              <div key={key} className="space-y-1" data-testid={`slider-${key}`}>
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-medium text-muted-foreground capitalize">
                    {key.replace(/([A-Z])/g, " $1").trim()}
                  </label>
                  <span className="text-xs font-mono font-semibold text-foreground">{value}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={value}
                  onChange={(e) => setRatings((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                  className="w-full h-1.5 bg-muted rounded-full appearance-none cursor-pointer accent-primary"
                />
              </div>
            ))}
          </div>

          {/* Text areas */}
          <div className="space-y-3">
            <TextareaField
              label="Strengths"
              value={strengths}
              onChange={setStrengths}
              placeholder="What does this manuscript do well?"
              testId="textarea-strengths"
            />
            <TextareaField
              label="Weaknesses"
              value={weaknesses}
              onChange={setWeaknesses}
              placeholder="What needs improvement?"
              testId="textarea-weaknesses"
            />
            <TextareaField
              label="Suggestions"
              value={suggestions}
              onChange={setSuggestions}
              placeholder="Actionable recommendations for the authors..."
              testId="textarea-suggestions"
            />
          </div>

          {/* Thermodynamic Anchor */}
          <div className="space-y-2 pt-2 border-t border-border">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Atom className="w-3 h-3" /> Thermodynamic Anchor (optional)
            </p>
            <InputField label="Baseline" value={baseline} onChange={setBaseline} placeholder="Current state / null hypothesis" testId="input-baseline" />
            <InputField label="Expected Outcome" value={expectedOutcome} onChange={setExpectedOutcome} placeholder="Predicted result if claims hold" testId="input-expected-outcome" />
            <InputField label="Measurement Method" value={measurementMethod} onChange={setMeasurementMethod} placeholder="How to verify entropy reduction" testId="input-measurement" />
          </div>

          <Button
            type="submit"
            className="w-full text-xs"
            disabled={submitting}
            data-testid="button-submit-review"
          >
            {submitting ? "Submitting..." : (
              <>
                <Send className="w-3 h-3 mr-1.5" />
                Submit Review
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function TextareaField({ label, value, onChange, placeholder, testId }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; testId: string;
}) {
  return (
    <div>
      <label className="text-[10px] font-medium text-muted-foreground block mb-1">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
        data-testid={testId}
      />
    </div>
  );
}

function InputField({ label, value, onChange, placeholder, testId }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; testId: string;
}) {
  return (
    <div>
      <label className="text-[10px] font-medium text-muted-foreground block mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        data-testid={testId}
      />
    </div>
  );
}
