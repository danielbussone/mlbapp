import { createTheme } from '@mui/material/styles';

/** Enables `--mui-palette-*` / spacing CSS vars for use in `.module.css` files (see ThemeProvider → CssVarsProvider). */
export const appTheme = createTheme({
  cssVariables: true,
  palette: {
    mode: 'light',
    primary: { main: '#00838f' },
    secondary: { main: '#c62828' },
  },
});
