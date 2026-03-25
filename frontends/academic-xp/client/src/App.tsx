import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/Layout";
import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import ManuscriptView from "@/pages/ManuscriptView";
import Leaderboard from "@/pages/Leaderboard";
import Credentials from "@/pages/Credentials";
import NotFound from "@/pages/not-found";

function AppRouter() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/manuscript/:id" component={ManuscriptView} />
        <Route path="/leaderboard" component={Leaderboard} />
        <Route path="/credentials" component={Credentials} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={useHashLocation}>
          <AppRouter />
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
