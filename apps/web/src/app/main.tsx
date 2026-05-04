import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { queryClient } from '@/api/queryClient.js';
import { App } from './App.js';
import { appTheme } from './theme.js';
import { CompareCareerPage } from '@/pages/CompareCareerPage.js';
import { CompareStatcastPage } from '@/pages/CompareStatcastPage.js';
import { PlayerCardPage } from '@/pages/PlayerCardPage.js';
import { PlayerCardWireframePreview } from '@/pages/PlayerCardWireframePreview.js';
import { PlayerMlbamRedirect } from '@/pages/PlayerMlbamRedirect.js';
import { PlayerCareerTrendsPage } from '@/pages/PlayerCareerTrendsPage.js';
import { PlayerPitchMixSupplementPage } from '@/pages/PlayerPitchMixSupplementPage.js';
import { FrvBreakdownPrototype } from '@/features/fielding-frv/FrvBreakdownPrototype.js';
import { OaaBreakdownPrototype } from '@/features/fielding-oaa/OaaBreakdownPrototype.js';
import { SwingTiltPrototypesPage } from '@/pages/SwingTiltPrototypesPage.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={appTheme}>
        <CssBaseline />
        <BrowserRouter>
          <Routes>
            {import.meta.env.DEV && (
              <>
                <Route path="/dev/cards-wireframe" element={<PlayerCardWireframePreview />} />
                <Route path="/dev/frv-prototype" element={<FrvBreakdownPrototype />} />
                <Route path="/dev/oaa-breakdown-prototype" element={<OaaBreakdownPrototype />} />
                <Route path="/dev/swing-tilt-prototypes" element={<SwingTiltPrototypesPage />} />
              </>
            )}
            <Route path="/players/mlbam/:mlbam" element={<PlayerMlbamRedirect />} />
            <Route path="/players/:playerId/trends" element={<PlayerCareerTrendsPage />} />
            <Route path="/players/:playerId/pitch-mix" element={<PlayerPitchMixSupplementPage />} />
            <Route path="/players/:playerId" element={<PlayerCardPage />} />
            <Route path="/compare/career" element={<CompareCareerPage />} />
            <Route path="/compare/statcast" element={<CompareStatcastPage />} />
            <Route path="/" element={<App />} />
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
      {import.meta.env.DEV ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </QueryClientProvider>
  </StrictMode>
);
