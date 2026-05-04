import Box from '@mui/material/Box';
import type { ReactNode } from 'react';
import { RailCollapsibleSection } from '@/components/rail/RailCollapsibleSection.js';
import styles from './LeaguePercentilesPanel.module.css';

type PercentileCollapsibleSectionProps = {
  title: ReactNode;
  open: boolean;
  onToggle: () => void;
  ariaLabelExpanded: string;
  ariaLabelCollapsed: string;
  children: ReactNode;
};

/** Grouped percentile rows inside `LeaguePercentilesPanel` (same rail accordion primitive as Statcast). */
export function PercentileCollapsibleSection({
  title,
  open,
  onToggle,
  ariaLabelExpanded,
  ariaLabelCollapsed,
  children,
}: PercentileCollapsibleSectionProps) {
  return (
    <Box className={styles.pitchTypeBlock}>
      <RailCollapsibleSection
        title={title}
        summaryVariant="caption"
        titleTypographyClassName={styles.pitchTypeLabel}
        expanded={open}
        onExpandedChange={(next) => {
          if (next !== open) onToggle();
        }}
        accordionSummaryProps={{
          'aria-label': open ? ariaLabelExpanded : ariaLabelCollapsed,
        }}
      >
        <Box className={styles.indent}>{children}</Box>
      </RailCollapsibleSection>
    </Box>
  );
}
