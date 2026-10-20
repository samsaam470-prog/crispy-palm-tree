/**
 * Answer reconstruction: rebuilds readable answers and compact mapping strings
 * from stored structured data, always joined against the ORIGINAL interview
 * version's question/option definitions (never a newer version).
 */

import type { Env } from '../types';
import type { AnswerRow } from '../types';
import { rows } from '../utils/db';
import type { InterviewDetail } from './interviews';

export interface ReconstructedAnswer {
  questionUid: string;
  questionNumber: number; // 1-based position within the version
  displayOrder: number;
  answerDisplay: 'full' | 'mapping';
  mapping: string; // e.g. "1:a,c" or raw text
  readable: string; // option labels / text; "; " separator for multi-select
}

interface AnswerWithOption extends AnswerRow {
  option_label: string | null;
  option_code: string | null;
  option_order: number | null;
}

/** Load all answers of one submission with their historical option snapshots. */
export async function loadAnswersForSubmission(
  env: Env,
  submissionRowId: number,
): Promise<AnswerWithOption[]> {
  return rows<AnswerWithOption>(
    env,
    `SELECT a.*, o.label AS option_label, o.code AS option_code, o.display_order AS option_order
     FROM answers a
     LEFT JOIN options o ON o.id = a.option_id
     WHERE a.submission_id = ?`,
    submissionRowId,
  );
}

/** Group answer rows per question and build ordered reconstructions. */
export function reconstructAnswers(detail: InterviewDetail, answerRows: AnswerWithOption[]): ReconstructedAnswer[] {
  const byQuestion = new Map<string, AnswerWithOption[]>();
  for (const a of answerRows) {
    const list = byQuestion.get(a.question_uid) ?? [];
    list.push(a);
    byQuestion.set(a.question_uid, list);
  }
  const out: ReconstructedAnswer[] = [];
  detail.questions.forEach((q, idx) => {
    const qnum = idx + 1;
    const list = byQuestion.get(q.uid) ?? [];
    if (list.length === 0) {
      // Documented representation for skipped optional questions: empty string.
      out.push({
        questionUid: q.uid,
        questionNumber: qnum,
        displayOrder: q.displayOrder,
        answerDisplay: q.answerDisplay,
        mapping: '',
        readable: '',
      });
      return;
    }
    const textRows = list.filter((a) => a.option_id === null);
    const optRows = list
      .filter((a) => a.option_id !== null)
      .sort((x, y) => (x.option_order ?? 0) - (y.option_order ?? 0)); // stable order

    let mapping: string;
    let readable: string;
    if (optRows.length > 0) {
      const codes = optRows.map((a) => a.mapping_code ?? a.option_code ?? '');
      mapping = `${qnum}:${codes.join(',')}`;
      const labels = optRows.map((a) => a.option_label ?? '');
      // Preserve "Other" free text unambiguously: "label (other: text)"
      const otherRow = optRows.find((a) => a.other_text);
      let readableParts = labels;
      if (otherRow?.other_text) {
        readableParts = labels.map((l) => (l === (otherRow.option_label ?? '') ? `${l} (other: ${otherRow.other_text})` : l));
      }
      readable = readableParts.join('; ');
    } else {
      const t = textRows[0]?.text_value ?? '';
      mapping = t;
      readable = t;
    }
    out.push({
      questionUid: q.uid,
      questionNumber: qnum,
      displayOrder: q.displayOrder,
      answerDisplay: q.answerDisplay,
      mapping,
      readable,
    });
  });
  return out;
}

/** Value to show given a question's display preference and requested mode. */
export function displayValue(
  ans: ReconstructedAnswer,
  mode: 'auto' | 'mapping' | 'readable',
): string {
  if (mode === 'mapping') return ans.mapping;
  if (mode === 'readable') return ans.readable;
  return ans.answerDisplay === 'mapping' ? ans.mapping : ans.readable;
}
