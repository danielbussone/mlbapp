import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import CssBaseline from '@mui/material/CssBaseline';
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { queryClient } from '@/api/queryClient.js';
import { App } from './App.js';
import { AppRouteErrorFallback } from './AppRouteErrorFallback.js';
import { appTheme } from './theme.js';

const MODE_STORAGE_KEY = 'mlbapp-mode';
const COLOR_SCHEME_STORAGE_KEY = 'mlbapp-color-scheme';

const CompareCareerPage = lazy(() =>
  import('@/pages/CompareCareerPage.js').then((m) => ({ default: m.CompareCareerPage })),
);
const CompareStatcastPage = lazy(() =>
  import('@/pages/CompareStatcastPage.js').then((m) => ({ default: m.CompareStatcastPage })),
);
const PlayerCardPage = lazy(() =>
  import('@/pages/PlayerCardPage.js').then((m) => ({ default: m.PlayerCardPage })),
);
const PlayerCardWireframePreview = lazy(() =>
  import('@/pages/PlayerCardWireframePreview.js').then((m) => ({ default: m.PlayerCardWireframePreview })),
);
const PlayerMlbamRedirect = lazy(() =>
  import('@/pages/PlayerMlbamRedirect.js').then((m) => ({ default: m.PlayerMlbamRedirect })),
);
const PlayerCareerTrendsPage = lazy(() =>
  import('@/pages/PlayerCareerTrendsPage.js').then((m) => ({ default: m.PlayerCareerTrendsPage })),
);
const PlayerPitchMixSupplementPage = lazy(() =>
  import('@/pages/PlayerPitchMixSupplementPage.js').then((m) => ({ default: m.PlayerPitchMixSupplementPage })),
);
const LeaderboardPage = lazy(() =>
  import('@/pages/LeaderboardPage.js').then((m) => ({ default: m.LeaderboardPage })),
);
const FrvBreakdownPrototype = lazy(() =>
  import('@/features/fielding-frv/FrvBreakdownPrototype.js').then((m) => ({ default: m.FrvBreakdownPrototype })),
);
const OaaBreakdownPrototype = lazy(() =>
  import('@/features/fielding-oaa/OaaBreakdownPrototype.js').then((m) => ({ default: m.OaaBreakdownPrototype })),
);
const SwingTiltPrototypesPage = lazy(() =>
  import('@/pages/SwingTiltPrototypesPage.js').then((m) => ({ default: m.SwingTiltPrototypesPage })),
);

function RouteFallback() {
  return (
    <Box display="flex" justifyContent="center" alignItems="center" minHeight="40vh">
      <CircularProgress aria-label="Loading page" />
    </Box>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <InitColorSchemeScript
        defaultMode="system"
        modeStorageKey={MODE_STORAGE_KEY}
        colorSchemeStorageKey={COLOR_SCHEME_STORAGE_KEY}
      />
      <ThemeProvider
        theme={appTheme}
        defaultMode="system"
        modeStorageKey={MODE_STORAGE_KEY}
        colorSchemeStorageKey={COLOR_SCHEME_STORAGE_KEY}
      >
        <CssBaseline />
        <BrowserRouter>
          <ErrorBoundary FallbackComponent={AppRouteErrorFallback}>
            <Suspense fallback={<RouteFallback />}>
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
                <Route path="/leaderboards" element={<LeaderboardPage />} />
                <Route path="/" element={<App />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </BrowserRouter>
      </ThemeProvider>
      {import.meta.env.DEV ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </QueryClientProvider>
  </StrictMode>
);
