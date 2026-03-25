import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy, Medal, Crown, Star, Shield, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fetchLeaderboard } from "@/lib/api";
import { allDomains, type ReviewerTier, type LeaderboardEntry } from "@/lib/mockData";

const tierBadgeColors: Record<ReviewerTier, string> = {
  Novice: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  Apprentice: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  Specialist: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  Expert: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  Master: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Pioneer: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
};

const rankIcons = [
  null,
  <Crown key="gold" className="w-4 h-4 text-amber-500" />,
  <Medal key="silver" className="w-4 h-4 text-gray-400" />,
  <Medal key="bronze" className="w-4 h-4 text-amber-700" />,
];

const domains = ["All", ...allDomains];

export default function Leaderboard() {
  const [selectedDomain, setSelectedDomain] = useState("All");

  const { data: leaderboard, isLoading } = useQuery<LeaderboardEntry[]>({
    queryKey: ["/api/leaderboard", selectedDomain],
    queryFn: () => fetchLeaderboard(selectedDomain),
  });

  const entries = leaderboard ?? [];

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif font-bold text-lg text-foreground flex items-center gap-2">
            <Trophy className="w-5 h-5 text-primary" />
            Leaderboard
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Season 3 · January – March 2025
          </p>
        </div>
        <Badge variant="outline" className="text-[10px] font-mono">
          <Star className="w-3 h-3 mr-1" />
          {entries.length} ranked reviewers
        </Badge>
      </div>

      {/* Domain filter tabs */}
      <Tabs value={selectedDomain} onValueChange={setSelectedDomain}>
        <TabsList className="h-8 gap-0.5">
          {domains.map((domain) => (
            <TabsTrigger
              key={domain}
              value={domain}
              className="text-[10px] px-2.5 py-1 h-6"
              data-testid={`tab-domain-${domain.toLowerCase()}`}
            >
              {domain}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Top 3 Podium */}
      {entries.length >= 3 && (
        <div className="grid grid-cols-3 gap-3">
          {[1, 0, 2].map((podiumIdx) => {
            const entry = entries[podiumIdx];
            if (!entry) return null;
            const isFirst = podiumIdx === 0;
            return (
              <Card
                key={entry.reviewer.id}
                className={`text-center ${isFirst ? "border-amber-500/30 bg-amber-500/5 dark:bg-amber-500/5" : ""}`}
                data-testid={`card-podium-${entry.rank}`}
              >
                <CardContent className="pt-4 pb-3 px-3">
                  <div className="flex justify-center mb-2">
                    {rankIcons[entry.rank]}
                  </div>
                  <p className={`text-sm font-semibold text-foreground ${isFirst ? "text-base" : ""}`}>
                    {entry.reviewer.name}
                  </p>
                  <Badge className={`text-[9px] mt-1 ${tierBadgeColors[entry.reviewer.tier]}`}>
                    {entry.reviewer.tier}
                  </Badge>
                  <p className="text-lg font-bold font-mono text-primary mt-2">
                    {entry.domainXP.toLocaleString()}
                  </p>
                  <p className="text-[10px] text-muted-foreground">XP</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Full Rankings Table */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold">Full Rankings</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground animate-pulse">
              Loading rankings...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px] pl-4 w-12">Rank</TableHead>
                  <TableHead className="text-[10px]">Reviewer</TableHead>
                  <TableHead className="text-[10px]">XP</TableHead>
                  <TableHead className="text-[10px]">Tier</TableHead>
                  <TableHead className="text-[10px]">Reviews</TableHead>
                  <TableHead className="text-[10px]">Avg Quality</TableHead>
                  <TableHead className="text-[10px] pr-4">Domains</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow
                    key={entry.reviewer.id}
                    className={entry.rank <= 3 ? "bg-primary/[0.02]" : ""}
                    data-testid={`row-rank-${entry.rank}`}
                  >
                    <TableCell className="pl-4 w-12">
                      <div className="flex items-center gap-1">
                        {entry.rank <= 3 ? rankIcons[entry.rank] : (
                          <span className="text-xs text-muted-foreground font-mono w-4 text-center">
                            {entry.rank}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-medium text-foreground">{entry.reviewer.name}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-mono font-semibold text-primary">
                        {entry.domainXP.toLocaleString()}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-[9px] ${tierBadgeColors[entry.reviewer.tier]}`}>
                        <Shield className="w-2.5 h-2.5 mr-0.5" />
                        {entry.reviewer.tier}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      {entry.seasonReviews}
                    </TableCell>
                    <TableCell>
                      <Tooltip>
                        <TooltipTrigger>
                          <span className="text-xs font-mono text-foreground flex items-center gap-1">
                            {entry.reviewer.avgQuality}%
                            <TrendingUp className="w-2.5 h-2.5 text-green-500" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>Average review quality score</TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="pr-4">
                      <div className="flex gap-1 flex-wrap">
                        {entry.reviewer.domains.map((d) => (
                          <Badge key={d} variant="outline" className="text-[9px] px-1.5">
                            {d}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
