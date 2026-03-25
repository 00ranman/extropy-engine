import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { TrendingUp, CheckCircle, Star, Shield, Clock, ArrowRight, Zap, Award } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Area, AreaChart } from "recharts";
import { fetchXP, fetchPendingReviews } from "@/lib/api";
import { mockCurrentUser, mockXPTransactions, tierThresholds, type ReviewerTier } from "@/lib/mockData";

const tierColors: Record<ReviewerTier, string> = {
  Novice: "text-gray-500 bg-gray-500/10",
  Apprentice: "text-green-600 bg-green-500/10",
  Specialist: "text-blue-600 bg-blue-500/10",
  Expert: "text-purple-600 bg-purple-500/10",
  Master: "text-amber-600 bg-amber-500/10",
  Pioneer: "text-primary bg-primary/10",
};

const priorityColors: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  high: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  urgent: "bg-destructive/10 text-destructive",
};

export default function Dashboard() {
  const { data: xpData } = useQuery({
    queryKey: ["/api/xp", mockCurrentUser.id],
    queryFn: () => fetchXP(mockCurrentUser.id),
  });

  const { data: pendingReviews } = useQuery({
    queryKey: ["/api/reviews/pending"],
    queryFn: () => fetchPendingReviews(),
  });

  const user = mockCurrentUser;
  const tierInfo = tierThresholds[user.tier];
  const nextTierName = getNextTier(user.tier);
  const nextTierInfo = nextTierName ? tierThresholds[nextTierName] : null;
  const tierProgress = nextTierInfo
    ? ((user.xp - tierInfo.min) / (nextTierInfo.min - tierInfo.min)) * 100
    : 100;

  const xpHistory = xpData?.history ?? [];
  const transactions = xpData?.transactions ?? mockXPTransactions;
  const reviews = pendingReviews ?? [];

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif font-bold text-lg text-foreground">
            Reviewer Dashboard
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Welcome back, {user.name}
          </p>
        </div>
        <Badge className={`${tierColors[user.tier]} text-xs font-semibold`}>
          <Shield className="w-3 h-3 mr-1" />
          {user.tier}
        </Badge>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          icon={<Zap className="w-3.5 h-3.5" />}
          label="Total XP"
          value={user.xp.toLocaleString()}
          change="+1,745 this month"
          testId="kpi-total-xp"
        />
        <KPICard
          icon={<CheckCircle className="w-3.5 h-3.5" />}
          label="Reviews Completed"
          value={user.reviewsCompleted.toString()}
          change="+12 this month"
          testId="kpi-reviews"
        />
        <KPICard
          icon={<Star className="w-3.5 h-3.5" />}
          label="Avg Quality Score"
          value={`${user.avgQuality}%`}
          change="Top 8% of reviewers"
          testId="kpi-quality"
        />
        <KPICard
          icon={<Award className="w-3.5 h-3.5" />}
          label="Current Tier"
          value={user.tier}
          change={nextTierName ? `${Math.round(tierProgress)}% to ${nextTierName}` : "Maximum tier reached"}
          testId="kpi-tier"
        />
      </div>

      {/* Tier Progress */}
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-foreground">{user.tier}</span>
            {nextTierName && (
              <span className="text-xs text-muted-foreground">
                {nextTierInfo!.min - user.xp} XP to {nextTierName}
              </span>
            )}
          </div>
          <Progress value={tierProgress} className="h-2" />
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-muted-foreground font-mono">{tierInfo.min.toLocaleString()} XP</span>
            {nextTierInfo && (
              <span className="text-[10px] text-muted-foreground font-mono">{nextTierInfo.min.toLocaleString()} XP</span>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* XP Chart */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-primary" />
              XP Growth
            </CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-3">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={xpHistory} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="xpGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(234, 62%, 46%)" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="hsl(234, 62%, 46%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  />
                  <RechartsTooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                      fontSize: "11px",
                    }}
                    formatter={(value: number) => [`${value.toLocaleString()} XP`, "Total XP"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="xp"
                    stroke="hsl(234, 62%, 46%)"
                    strokeWidth={2}
                    fill="url(#xpGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="space-y-2.5 max-h-52 overflow-y-auto">
              {transactions.slice(0, 6).map((tx) => (
                <div key={tx.id} className="flex items-start justify-between gap-2" data-testid={`activity-${tx.id}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground truncate">{tx.reason}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(tx.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </p>
                  </div>
                  <span className={`text-xs font-mono font-medium shrink-0 ${tx.type === "review" ? "text-primary" : "text-green-600 dark:text-green-400"}`}>
                    +{tx.amount}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pending Reviews Table */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            Pending Reviews
          </CardTitle>
          <Badge variant="secondary" className="text-[10px]">{reviews.length} pending</Badge>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] pl-4">Manuscript</TableHead>
                <TableHead className="text-[10px]">Domain</TableHead>
                <TableHead className="text-[10px]">Deadline</TableHead>
                <TableHead className="text-[10px]">Priority</TableHead>
                <TableHead className="text-[10px]">Est. Time</TableHead>
                <TableHead className="text-[10px] pr-4"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviews.map((review) => (
                <TableRow key={review.id} data-testid={`row-review-${review.id}`}>
                  <TableCell className="text-xs font-medium pl-4 max-w-[200px] truncate">
                    {review.manuscriptTitle}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">{review.domain}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(review.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </TableCell>
                  <TableCell>
                    <Badge className={`text-[10px] ${priorityColors[review.priority]}`}>
                      {review.priority}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{review.estimatedTime}</TableCell>
                  <TableCell className="pr-4">
                    <Link href={`/manuscript/${review.manuscriptId}`}>
                      <Button variant="ghost" size="sm" className="text-xs h-6 px-2" data-testid={`button-review-${review.id}`}>
                        Review <ArrowRight className="w-3 h-3 ml-1" />
                      </Button>
                    </Link>
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

function KPICard({ icon, label, value, change, testId }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  change: string;
  testId: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="pt-3 pb-2.5 px-3">
        <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
          {icon}
          <span className="text-[10px] font-medium uppercase tracking-wider">{label}</span>
        </div>
        <p className="text-lg font-semibold text-foreground font-mono">{value}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">{change}</p>
      </CardContent>
    </Card>
  );
}

function getNextTier(current: ReviewerTier): ReviewerTier | null {
  const order: ReviewerTier[] = ["Novice", "Apprentice", "Specialist", "Expert", "Master", "Pioneer"];
  const idx = order.indexOf(current);
  return idx < order.length - 1 ? order[idx + 1] : null;
}
