/**
 * Generates markdown learnings from historical brief quality signals.
 * Injected into the brief generator prompt for self-improving brief quality.
 */

import { desc } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { briefQualitySignals } from '../db/schema.js';

export async function getGeneratorLearnings(db: Db): Promise<string> {
  const rows = await db
    .select()
    .from(briefQualitySignals)
    .orderBy(desc(briefQualitySignals.computedAt))
    .limit(100);

  if (rows.length < 3) return '';

  const total = rows.length;
  const allEightsCount = rows.filter(r => r.allEights === true).length;
  const tiedCount = rows.filter(r => r.tied === true).length;
  const spreads = rows
    .map(r => r.scoreSpread ? Number(r.scoreSpread) : null)
    .filter((s): s is number => s !== null);
  const avgSpread = spreads.length > 0
    ? spreads.reduce((a, b) => a + b, 0) / spreads.length
    : 0;

  // Criterion-level analysis: find criteria that consistently have zero spread
  const flatCriteria = new Map<string, number[]>();
  for (const row of rows) {
    const signals = row.criterionSignals as Array<{ criterionId: string; scoreSpread: number }> | null;
    if (!signals) continue;
    for (const s of signals) {
      if (!flatCriteria.has(s.criterionId)) flatCriteria.set(s.criterionId, []);
      flatCriteria.get(s.criterionId)!.push(s.scoreSpread);
    }
  }

  const flatCriteriaNames: string[] = [];
  for (const [name, spreadsArr] of flatCriteria) {
    const avg = spreadsArr.reduce((a, b) => a + b, 0) / spreadsArr.length;
    if (avg < 0.5 && spreadsArr.length >= 3) {
      flatCriteriaNames.push(name);
    }
  }

  const lines: string[] = [
    `Based on ${total} recent competitions:`,
  ];

  const allEightsPct = ((allEightsCount / total) * 100).toFixed(0);
  if (allEightsCount > 0) {
    lines.push(`- ${allEightsPct}% had all scores in the 7-9 range ("all eights"), suggesting rubric criteria may lack specificity. Add measurable acceptance criteria or expected outputs.`);
  }

  const tiedPct = ((tiedCount / total) * 100).toFixed(0);
  if (tiedCount > 0) {
    lines.push(`- ${tiedPct}% resulted in ties (score spread < 0.01). Consider adding more differentiating criteria or constraints.`);
  }

  lines.push(`- Average score spread across competitions: ${avgSpread.toFixed(3)}. ${avgSpread < 0.05 ? 'This is low — briefs may need sharper evaluation criteria.' : 'Good differentiation.'}`);

  if (flatCriteriaNames.length > 0) {
    lines.push(`- These criteria consistently show zero differentiation between teams: ${flatCriteriaNames.join(', ')}. Consider making them more specific or replacing them.`);
  }

  return lines.join('\n');
}
