import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';

export type JawsExpandedApiRole = 'batting' | 'pitching';

export type JawsExpandedWirePayload = {
  jaws_expanded_spec_version: string;
  war_basis: 'fwar';
  role: JawsExpandedApiRole;
  position_key: string | null;
  position_label: string | null;
  player: {
    career_war: number | null;
    peak_war_fwar: number | null;
    jaws_fwar: number | null;
    war_per_162: number | null;
    war_per_rate_suffix: string;
    career_pa: number | null;
    career_games: number | null;
  };
  cohort: {
    cohort_n: number | null;
    rank: number | null;
    rank_display: string | null;
    qualified: boolean;
    unavailable_reason?: string | null;
  };
  hof_average: {
    n: number;
    career_war: number | null;
    peak_war_fwar: number | null;
    jaws_fwar: number | null;
    war_per_162: number | null;
  } | null;
  notes: string[];
};

function fmt1(x: number | null | undefined): string {
  if (x == null || typeof x !== 'number' || !Number.isFinite(x)) return '—';
  return x.toFixed(1);
}

const jawsTooltip =
  'JAWS (fWAR): (career FanGraphs WAR + sum of your seven highest single-season fWAR) / 2. Baseball-Reference JAWS uses rWAR — values differ. The line under your position is your JAWS rank among all cohort-qualified players at that spot (1st = highest JAWS). The block below is the average Hall of Famer at that position. For pitchers, the last column is fWAR scaled to 200 IP (SP), 60 IP (RP), or 130 IP (SP/RP hybrid), not WAR per 162 team games.';

export function JawsExpandedBlock({
  playerId,
  fgRole,
  summaryJaws,
}: {
  playerId: number;
  fgRole: JawsExpandedApiRole;
  /** FG card JAWS while the expanded API request is in flight. */
  summaryJaws: number | null;
}) {
  const [data, setData] = useState<JawsExpandedWirePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setData(null);
    void (async () => {
      try {
        const r = await fetch(`/api/players/${playerId}/jaws-expanded?role=${fgRole}`);
        const j = (await r.json()) as JawsExpandedWirePayload & { error?: string };
        if (cancelled) return;
        if (!r.ok) {
          setErr(typeof j.error === 'string' ? j.error : 'Failed to load JAWS');
          setData(null);
          return;
        }
        setData(j);
      } catch {
        if (!cancelled) {
          setErr('Failed to load JAWS');
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playerId, fgRole]);

  const j0 =
    summaryJaws != null && Number.isFinite(summaryJaws) ? summaryJaws.toFixed(1) : null;
  if (j0 == null) return null;

  const p = data?.player;
  const h = data?.hof_average;
  const posKey = data?.position_key ?? null;
  const posLabel = data?.position_label ?? null;
  const rankDisp = data?.cohort.rank_display;
  const cohortN = data?.cohort.cohort_n;
  const pkForCopy = posKey != null && posKey.trim() !== '' ? posKey.trim() : 'this position';

  const posHeading =
    posLabel != null && rankDisp != null && cohortN != null && cohortN > 0
      ? `${posLabel} (${rankDisp} of ${cohortN} ${pkForCopy}):`
      : posLabel != null
        ? `${posLabel}:`
        : data != null && !data.cohort.qualified
          ? (data.cohort.unavailable_reason ?? 'JAWS rank unavailable (see notes).')
          : null;

  const warPerSuffix = p?.war_per_rate_suffix ?? 'WAR/162';
  const statParts =
    p != null
      ? [
          `${fmt1(p.career_war)} career WAR`,
          `${fmt1(p.peak_war_fwar)} 7yr-peak WAR`,
          `${fmt1(p.jaws_fwar)} JAWS`,
          `${fmt1(p.war_per_162)} ${warPerSuffix}`,
        ].filter((x): x is string => x != null)
      : [];

  const statLine = statParts.length > 0 ? statParts.join(' | ') : null;

  const hofStatParts =
    h != null && h.n > 0
      ? [
          `${fmt1(h.career_war)} career WAR`,
          `${fmt1(h.peak_war_fwar)} 7yr-peak WAR`,
          `${fmt1(h.jaws_fwar)} JAWS`,
          `${fmt1(h.war_per_162)} ${warPerSuffix}`,
        ]
      : [];

  const hofValueLine = hofStatParts.length > 0 ? hofStatParts.join(' | ') : null;

  const hofSectionTitle =
    h != null && h.n > 0 ? `Average HOF ${pkForCopy} (${h.n}):` : null;

  const cohortComplete =
    data != null &&
    data.cohort.qualified === true &&
    data.cohort.rank_display != null &&
    hofValueLine != null;

  return (
    <Stack spacing={0.5} sx={{ pt: 0.25 }} title={jawsTooltip}>
      <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.2, cursor: 'help' }}>
        JAWS
      </Typography>
      {loading && (
        <Typography variant="caption" color="text.secondary" display="block">
          JAWS (fWAR): {j0} — loading…
        </Typography>
      )}
      {err != null && (
        <Typography variant="caption" color="error" display="block">
          JAWS (fWAR): {j0} — {err}
        </Typography>
      )}
      {!loading && data != null && (
        <Box sx={{ pl: 0.5 }}>
          {posHeading != null && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ pl: 1 }}>
              {posHeading}
            </Typography>
          )}
          {statLine != null && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ pl: 2.5, pt: 0.15 }}>
              {statLine}
            </Typography>
          )}
          {hofSectionTitle != null && hofValueLine != null && (
            <>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ pl: 1, pt: 0.35 }}>
                {hofSectionTitle}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ pl: 2.5, pt: 0.15 }}>
                {hofValueLine}
              </Typography>
            </>
          )}
          {!cohortComplete && data.notes.length > 0 && (
            <Typography variant="caption" color="text.disabled" display="block" sx={{ pl: 0.5, pt: 0.35 }}>
              {data.notes[0]}
            </Typography>
          )}
        </Box>
      )}
    </Stack>
  );
}
