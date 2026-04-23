import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { App } from './App.js';
import { PlayerCardPage } from './PlayerCardPage.js';
import { PlayerCardWireframePreview } from './PlayerCardWireframePreview.js';
import { PlayerMlbamRedirect } from './PlayerMlbamRedirect.js';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#00838f' },
    secondary: { main: '#c62828' },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          {import.meta.env.DEV && (
            <Route path="/dev/cards-wireframe" element={<PlayerCardWireframePreview />} />
          )}
          <Route path="/players/mlbam/:mlbam" element={<PlayerMlbamRedirect />} />
          <Route path="/players/:playerId" element={<PlayerCardPage />} />
          <Route path="/" element={<App />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>
);
