/**
 * @module server
 * LevelUp Academy — Adaptive Learning Microservice
 *
 * Provides REST endpoints for lesson delivery, progress tracking,
 * XP award (via @extropy/xp-formula), and Bayesian skill-level estimation.
 *
 * Port: 4008 (default)
 */
import express from 'express';
import { AdaptiveEngineService } from './services/adaptive-engine.service';

const app = express();
app.use(express.json());

const engine = new AdaptiveEngineService();

/** GET /health */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: '@extropy/levelup-academy', ts: new Date().toISOString() });
});

/** GET /lessons — list available lessons for a skill domain */
app.get('/lessons', async (req, res, next) => {
  try {
    const domain = String(req.query.domain ?? 'general');
    const lessons = await engine.listLessons(domain);
    res.json({ lessons, domain });
  } catch (e) { next(e); }
});

/** POST /lesson/start — begin an adaptive lesson session */
app.post('/lesson/start', async (req, res, next) => {
  try {
    const { agentId, lessonId } = req.body as { agentId: string; lessonId: string };
    if (!agentId || !lessonId) {
      res.status(400).json({ error: 'agentId and lessonId required' });
      return;
    }
    const session = await engine.startSession(agentId, lessonId);
    res.json(session);
  } catch (e) { next(e); }
});

/** POST /lesson/submit — submit answer and receive adaptive next question + XP award */
app.post('/lesson/submit', async (req, res, next) => {
  try {
    const { sessionId, answer } = req.body as { sessionId: string; answer: string };
    if (!sessionId || answer === undefined) {
      res.status(400).json({ error: 'sessionId and answer required' });
      return;
    }
    const result = await engine.submitAnswer(sessionId, answer);
    res.json(result);
  } catch (e) { next(e); }
});

/** GET /progress/:agentId — get learner skill profile */
app.get('/progress/:agentId', async (req, res, next) => {
  try {
    const profile = await engine.getSkillProfile(req.params.agentId);
    res.json(profile);
  } catch (e) { next(e); }
});

/** Generic error handler */
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[levelup-academy]', err);
  res.status(500).json({ error: err.message });
});

const PORT = parseInt(process.env.PORT ?? '4008', 10);
app.listen(PORT, () => {
  console.log(`[@extropy/levelup-academy] listening on port ${PORT}`);
});

export default app;
