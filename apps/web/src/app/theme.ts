import { alpha, createTheme } from '@mui/material/styles';

/** Enables `--mui-palette-*` CSS vars for `.module.css` (ThemeProvider + `cssVariables: true`). */
export const appTheme = createTheme({
  cssVariables: true,
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#00838f' },
        secondary: { main: '#c62828' },
      },
    },
    dark: {
      palette: {
        primary: { main: '#4dd0e1', light: '#88ffff', dark: '#f5feff' },
        secondary: { main: '#ff5252', light: '#ff867f', dark: '#c50e29' },
        /** Dark-mode canvas: darker, greyer teal than rgb(80,130,130). */
        background: {
          default: 'rgb(85, 126, 126)',
          paper: 'rgb(37, 68, 72)',
        },
      },
    },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        /**
         * MUI 6 text buttons use `color: var(--variant-textColor)` fed from `palette.primary.main`.
         * In dark mode, primary teal on paper/canvas reads like body text should be white instead.
         * (Contained/outlined primary still use their own variant tokens.)
         */
        root: ({ theme, ownerState }) => {
          const isDarkTextPrimary =
            theme.palette.mode === 'dark' &&
            ownerState.variant === 'text' &&
            ownerState.color === 'primary';
          if (!isDarkTextPrimary) {
            return {};
          }
          return {
            '--variant-textColor': theme.palette.common.white,
            '--variant-outlinedColor': theme.palette.common.white,
            '@media (hover: hover)': {
              '&:hover': {
                '--variant-textBg': alpha(
                  theme.palette.common.white,
                  theme.palette.action.hoverOpacity,
                ),
              },
            },
          };
        },
      },
    },
  },
});
