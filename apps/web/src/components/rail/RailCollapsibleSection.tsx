import ExpandMore from '@mui/icons-material/ExpandMore';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary, { type AccordionSummaryProps } from '@mui/material/AccordionSummary';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import railStyles from './RailCollapsibleSection.module.css';

type RailCollapsibleSectionBase = {
  title: ReactNode;
  children: ReactNode;
  /** Default: subtitle2 (Statcast / outer league rail). Use caption for dense percentile subgroups. */
  summaryVariant?: 'subtitle2' | 'caption';
  /** Applied on the root Accordion (e.g. spacing overrides). */
  className?: string;
  /** AccordionDetails className; default flushes top padding. */
  detailsClassName?: string;
  /** Extra class on the summary title Typography. */
  titleTypographyClassName?: string;
  /** Passed through to `AccordionSummary` (e.g. `slotProps`, `aria-*`). */
  accordionSummaryProps?: Omit<AccordionSummaryProps, 'children' | 'expandIcon'>;
};

export type RailCollapsibleSectionProps =
  | (RailCollapsibleSectionBase & {
      expanded: boolean;
      onExpandedChange: (next: boolean) => void;
    })
  | (RailCollapsibleSectionBase & {
      defaultExpanded?: boolean;
      expanded?: undefined;
      onExpandedChange?: undefined;
    });

function isControlled(
  props: RailCollapsibleSectionProps,
): props is RailCollapsibleSectionBase & { expanded: boolean; onExpandedChange: (next: boolean) => void } {
  return 'expanded' in props && typeof props.onExpandedChange === 'function';
}

/** Single MUI Accordion pattern for player-card rails (Statcast, league percentiles, percentile subsections). */
export function RailCollapsibleSection(props: RailCollapsibleSectionProps) {
  const {
    title,
    children,
    summaryVariant = 'subtitle2',
    className,
    detailsClassName = railStyles.detailsFlush,
    titleTypographyClassName,
    accordionSummaryProps,
  } = props;
  const rootClass = [railStyles.railAccordion, className].filter(Boolean).join(' ');
  const titleClass = [
    summaryVariant === 'caption' ? railStyles.summaryCaption : railStyles.summarySubtitle,
    titleTypographyClassName,
  ]
    .filter(Boolean)
    .join(' ');

  const summary = (
    <AccordionSummary
      expandIcon={<ExpandMore fontSize="small" />}
      slotProps={{
        expandIconWrapper: { 'aria-hidden': true },
      }}
      {...accordionSummaryProps}
    >
      {summaryVariant === 'caption' ? (
        <Typography variant="caption" className={titleClass}>
          {title}
        </Typography>
      ) : (
        <Typography variant="subtitle2" className={titleClass}>
          {title}
        </Typography>
      )}
    </AccordionSummary>
  );

  if (isControlled(props)) {
    return (
      <Accordion
        expanded={props.expanded}
        onChange={(_, exp) => props.onExpandedChange(exp)}
        disableGutters
        elevation={0}
        className={rootClass}
      >
        {summary}
        <AccordionDetails className={detailsClassName}>{children}</AccordionDetails>
      </Accordion>
    );
  }

  const defaultExpanded = props.defaultExpanded !== false;
  return (
    <Accordion defaultExpanded={defaultExpanded} disableGutters elevation={0} className={rootClass}>
      {summary}
      <AccordionDetails className={detailsClassName}>{children}</AccordionDetails>
    </Accordion>
  );
}
