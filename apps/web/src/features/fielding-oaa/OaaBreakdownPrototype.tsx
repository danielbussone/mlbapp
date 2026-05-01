import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import { Link } from 'react-router-dom';

import { OaaDirectionalField } from './OaaDirectionalField.js';
import { OaaIfDirectionalField } from './OaaIfDirectionalField.js';
import { MOCK_IF_OAA_CELLS, MOCK_OF_DIR_CELLS, sumOaaFromCells, type OaaCellRow } from './oaaBreakdownMockData.js';
import styles from './OaaBreakdownPrototype.module.css';

const DEMO_YEAR = 2025;

function cellsToApiShape(rows: OaaCellRow[]): Record<string, unknown>[] {
  return rows.map((r) => ({
    cell_id: r.cell_id,
    oaa: r.oaa,
    attempts: r.attempts,
  }));
}

/**
 * Dev-only: **OF** directional OAA matches production wiring (`OaaHeatmapPlaceholder` → `OaaDirectionalField`) but uses
 * mock `of_dir_*` cells. **IF** mirrors the same `if_dir_*` pie at **1B / 2B / 3B / SS** (`OaaIfDirectionalField`). **`/dev/oaa-breakdown-prototype`**
 */
export function OaaBreakdownPrototype() {
  const ofCells = cellsToApiShape(MOCK_OF_DIR_CELLS);
  const ofTotal = sumOaaFromCells(MOCK_OF_DIR_CELLS, (id) => id.startsWith('of_dir_'));

  return (
    <Container maxWidth={false} className={styles.page}>
      <Button component={Link} to="/" startIcon={<ArrowBackIcon />} size="small" className={styles.back}>
        Back to chat
      </Button>
      <Typography variant="h5" component="h1" gutterBottom className={styles.title}>
        OAA breakdown prototype (OF + IF)
      </Typography>
      <Typography variant="body2" color="text.secondary" className={styles.lead}>
        <strong>Outfield</strong> below reuses the shipped <code>OaaDirectionalField</code> with mock data shaped like{' '}
        <code>GET /api/players/:id/fielding-oaa</code> cells. <strong>Infield</strong> shows the same mock <code>if_dir_*</code>{' '}
        breakdown at <strong>1B</strong>, <strong>2B</strong>, <strong>3B</strong>, and <strong>SS</strong> (see{' '}
        <code>IF_OAA_MINI_PIE_ANCHORS</code> + <code>INFIELD_DIAMOND_SCALE</code>) per{' '}
        <code>docs/SAVANT_INFIELD_OAA_AND_FRV_PLAN.md</code> §3.1 — production <code>OaaHeatmapPlaceholder</code> routes{' '}
        <code>of_dir_*</code> or <code>if_dir_*</code> when ingested.
      </Typography>

      <Typography variant="h6" className={styles.sectionHeading}>
        Outfield — backfill from production
      </Typography>
      <Typography variant="body2" color="text.secondary" className={styles.sectionBody}>
        Player card: <code>OaaHeatmapPlaceholder</code> fetches <code>fielding-oaa</code>; when any row has{' '}
        <code>cell_id</code> starting with <code>of_dir_</code>, it renders this same six-slice pie on{' '}
        <code>spray/dodger-stadium-dimensions.png</code> with anchor LF / CF / RF from FanGraphs innings (here: mock{' '}
        <strong>CF</strong>, percentile dial omitted → center fill uses 50th grey like missing league payload).
      </Typography>
      <OaaDirectionalField
        cells={ofCells}
        gameYear={DEMO_YEAR}
        anchor="CF"
        anchorResolvedFromFg
        totalOaa={ofTotal}
        oaaGoodnessDp={null}
      />

      <Divider className={styles.dividerMajor} />

      <Typography variant="h6" className={styles.subsectionTitle}>
        Infield — MVP sketch (planned ingest)
      </Typography>
      <Typography variant="body2" color="text.secondary" className={styles.sectionBody}>
        Four 90° wedges (same data at each anchor) at 1B/3B bags and 2B/SS holes; center = sum of slice OAA.         Same component path as the player card after <code>pnpm etl:fielding-oaa-if</code>.
      </Typography>
      <OaaIfDirectionalField
        cells={cellsToApiShape(MOCK_IF_OAA_CELLS)}
        gameYear={DEMO_YEAR}
        primaryAnchorId="ss"
        primaryPosNote="Dev demo: anchor locked to SS."
      />
    </Container>
  );
}
