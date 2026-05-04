import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import type { FallbackProps } from 'react-error-boundary';

export function AppRouteErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <Box sx={{ p: 2, maxWidth: 560, mx: 'auto', mt: 4 }}>
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={resetErrorBoundary}>
            Try again
          </Button>
        }
      >
        <Typography variant="subtitle2" gutterBottom>
          Something went wrong
        </Typography>
        <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', m: 0, fontFamily: 'inherit' }}>
          {error instanceof Error ? error.message : String(error)}
        </Typography>
      </Alert>
    </Box>
  );
}
