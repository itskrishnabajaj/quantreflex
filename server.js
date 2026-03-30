const express = require('express');
const path = require('path');
const aiService = require('./services/aiService');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.static(path.join(__dirname), {
  extensions: ['html'],
  index: 'index.html'
}));

app.post('/api/ai/word-problems', async (req, res) => {
  try {
    const { category, difficulty, count } = req.body;
    if (!category || !difficulty || !count) {
      return res.status(400).json({ error: 'Missing required fields: category, difficulty, count' });
    }
    const clampedCount = Math.min(Math.max(parseInt(count) || 5, 1), 20);
    const questions = await aiService.generateWordProblems(category, difficulty, clampedCount);
    res.json({ questions });
  } catch (err) {
    console.error('Word problems error:', err.message);
    res.status(500).json({ error: 'Unable to generate word problems right now. Try again later.' });
  }
});

app.post('/api/ai/explain', async (req, res) => {
  try {
    const { question, answer, category } = req.body;
    if (!question || answer === undefined) {
      return res.status(400).json({ error: 'Missing required fields: question, answer' });
    }
    const explanation = await aiService.generateExplanation(question, answer, category);
    res.json({ explanation });
  } catch (err) {
    console.error('Explanation error:', err.message);
    res.status(500).json({ error: 'Unable to generate explanation right now. Try again later.' });
  }
});

app.post('/api/ai/insights', async (req, res) => {
  try {
    const { stats } = req.body;
    if (!stats) {
      return res.status(400).json({ error: 'Missing required field: stats' });
    }
    const insights = await aiService.generateInsights(stats);
    res.json({ insights });
  } catch (err) {
    console.error('Insights error:', err.message);
    res.status(500).json({ error: 'Unable to generate insights right now. Try again later.' });
  }
});

app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`QuantReflex server running on port ${PORT}`);
});
