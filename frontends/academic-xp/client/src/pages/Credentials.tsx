import { useQuery } from "@tanstack/react-query";
import {
  Award, Download, Code, Image, Shield, Star, Flame, Globe,
  Crown, TrendingUp, Users, FileText, ExternalLink
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";
import { fetchCredentials } from "@/lib/api";
import {
  mockCurrentUser, mockXPTransactions, type Achievement, type ReviewerTier,
} from "@/lib/mockData";
import { useToast } from "@/hooks/use-toast";

const rarityColors: Record<string, string> = {
  common: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  uncommon: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  rare: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  epic: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  legendary: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
};

const achievementIcons: Record<string, React.ReactNode> = {
  star: <Star className="w-4 h-4" />,
  award: <Award className="w-4 h-4" />,
  users: <Users className="w-4 h-4" />,
  globe: <Globe className="w-4 h-4" />,
  shield: <Shield className="w-4 h-4" />,
  flame: <Flame className="w-4 h-4" />,
  "trending-up": <TrendingUp className="w-4 h-4" />,
  crown: <Crown className="w-4 h-4" />,
};

const tierColors: Record<ReviewerTier, string> = {
  Novice: "text-gray-500",
  Apprentice: "text-green-600",
  Specialist: "text-blue-600",
  Expert: "text-purple-600",
  Master: "text-amber-600",
  Pioneer: "text-indigo-600",
};

export default function Credentials() {
  const { toast } = useToast();

  const { data } = useQuery({
    queryKey: ["/api/credentials", mockCurrentUser.id],
    queryFn: () => fetchCredentials(mockCurrentUser.id),
  });

  const user = data?.user ?? mockCurrentUser;
  const achievements = data?.achievements ?? [];
  const domainExpertise = data?.domainExpertise ?? [];

  const radarData = domainExpertise.map((d) => ({
    domain: d.domain,
    score: d.score,
    fullMark: 100,
  }));

  const handleExport = (type: string) => {
    toast({
      title: `${type} export`,
      description: `${type} generation initiated. This is a demo — in production, this downloads a real file.`,
    });
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="font-serif font-bold text-lg text-foreground flex items-center gap-2">
          <Award className="w-5 h-5 text-primary" />
          Credentials & Portfolio
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Verifiable review portfolio with exportable credentials
        </p>
      </div>

      {/* Portfolio Summary */}
      <Card>
        <CardContent className="pt-4 pb-4 px-4">
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-serif font-bold text-lg shrink-0">
              {user.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">{user.name}</h2>
                <Badge className={`text-[9px] ${tierColors[user.tier]}`}>
                  <Shield className="w-2.5 h-2.5 mr-0.5" />
                  {user.tier}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Member since {new Date(user.joinedAt).toLocaleDateString("en-US", { year: "numeric", month: "long" })}
              </p>
              <div className="flex gap-4 mt-2">
                <MiniStat label="Total XP" value={user.xp.toLocaleString()} />
                <MiniStat label="Reviews" value={user.reviewsCompleted.toString()} />
                <MiniStat label="Avg Quality" value={`${user.avgQuality}%`} />
                <MiniStat label="Domains" value={user.domains.length.toString()} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Domain Expertise Radar Chart */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold">Domain Expertise</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-3">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                  <PolarGrid stroke="hsl(var(--border))" />
                  <PolarAngleAxis
                    dataKey="domain"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <PolarRadiusAxis
                    angle={30}
                    domain={[0, 100]}
                    tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                    tickCount={5}
                  />
                  <Radar
                    name="Expertise"
                    dataKey="score"
                    stroke="hsl(234, 62%, 46%)"
                    fill="hsl(234, 62%, 46%)"
                    fillOpacity={0.15}
                    strokeWidth={2}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            {/* Domain bars below */}
            <div className="space-y-2 px-2 mt-2">
              {domainExpertise.map((d) => (
                <div key={d.domain} className="space-y-0.5" data-testid={`domain-bar-${d.domain.toLowerCase()}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-muted-foreground">{d.domain}</span>
                    <span className="text-[10px] font-mono text-foreground">{d.score}% · {d.reviews} reviews</span>
                  </div>
                  <Progress value={d.score} className="h-1" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Achievements Grid */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5 text-amber-500" />
              Achievements
              <Badge variant="secondary" className="text-[9px] ml-auto">{achievements.length} earned</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-2 gap-2">
              {achievements.map((ach) => (
                <AchievementCard key={ach.id} achievement={ach} />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Export Options */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold">Export Credentials</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ExportButton
              icon={<Download className="w-3.5 h-3.5" />}
              label="Export PDF Portfolio"
              description="Full review history with scores"
              onClick={() => handleExport("PDF Portfolio")}
              testId="button-export-pdf"
            />
            <ExportButton
              icon={<Code className="w-3.5 h-3.5" />}
              label="Export JSON-LD for ORCID"
              description="Machine-readable credential data"
              onClick={() => handleExport("JSON-LD")}
              testId="button-export-jsonld"
            />
            <ExportButton
              icon={<Image className="w-3.5 h-3.5" />}
              label="Generate Embeddable Badge"
              description="HTML snippet for your website"
              onClick={() => handleExport("Embeddable Badge")}
              testId="button-export-badge"
            />
          </div>
        </CardContent>
      </Card>

      {/* Review History Table */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-muted-foreground" />
            Review History
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] pl-4">Activity</TableHead>
                <TableHead className="text-[10px]">Type</TableHead>
                <TableHead className="text-[10px]">XP Earned</TableHead>
                <TableHead className="text-[10px] pr-4">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mockXPTransactions.map((tx) => (
                <TableRow key={tx.id} data-testid={`row-history-${tx.id}`}>
                  <TableCell className="text-xs pl-4 max-w-[250px] truncate">{tx.reason}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[9px] capitalize">{tx.type}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs font-mono font-semibold text-primary">+{tx.amount}</span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground pr-4">
                    {new Date(tx.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-xs font-semibold font-mono text-foreground">{value}</p>
    </div>
  );
}

function AchievementCard({ achievement }: { achievement: Achievement }) {
  const icon = achievementIcons[achievement.icon] ?? <Star className="w-4 h-4" />;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={`rounded-lg p-2.5 border border-border hover-elevate cursor-default ${rarityColors[achievement.rarity]}`}
          data-testid={`achievement-${achievement.id}`}
        >
          <div className="flex items-center gap-2">
            <div className="shrink-0">{icon}</div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold truncate">{achievement.name}</p>
              <p className="text-[9px] opacity-70 capitalize">{achievement.rarity}</p>
            </div>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">{achievement.description}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Earned {new Date(achievement.earnedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

function ExportButton({ icon, label, description, onClick, testId }: {
  icon: React.ReactNode; label: string; description: string; onClick: () => void; testId: string;
}) {
  return (
    <Button
      variant="outline"
      className="h-auto py-3 px-3 flex flex-col items-start gap-1 text-left"
      onClick={onClick}
      data-testid={testId}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium">
        {icon} {label}
      </div>
      <p className="text-[10px] text-muted-foreground font-normal">{description}</p>
    </Button>
  );
}
