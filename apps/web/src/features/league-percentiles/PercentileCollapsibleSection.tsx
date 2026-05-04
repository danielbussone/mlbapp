import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import styles from './LeaguePercentilesPanel.module.css';

type PercentileCollapsibleSectionProps = {
  title: ReactNode;
  open: boolean;
  onToggle: () => void;
  ariaLabelExpanded: string;
  ariaLabelCollapsed: string;
  children: ReactNode;
};

/** Header row + MUI Collapse used for grouped percentile rows inside `LeaguePercentilesPanel`. */
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
      <Stack direction="row" alignItems="center" spacing={0.25} className={styles.pitchTypeHeader}>
        <IconButton
          size="small"
          aria-expanded={open}
          aria-label={open ? ariaLabelExpanded : ariaLabelCollapsed}
          onClick={onToggle}
          className={styles.iconTight}
        >
          {open ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
        </IconButton>
        <Typography variant="caption" className={styles.pitchTypeLabel}>
          {title}
        </Typography>
      </Stack>
      <Collapse in={open} timeout="auto" unmountOnExit>
        <Box className={styles.indent}>{children}</Box>
      </Collapse>
    </Box>
  );
}
