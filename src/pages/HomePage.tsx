import { type ReactElement } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import { useHealth } from "../hooks/useHealth";

/**
 * The homepage. Says "Hello World" and renders the live result of
 * `GET /api/health` underneath it, which doubles as the manual sniff test that
 * the Vite `/api` proxy and the Express server are both up.
 *
 * The three render branches are mutually exclusive AND all reachable, on
 * purpose: `useHealth` clears `health` whenever it sets an error, so no state
 * combination here is dead code.
 * @returns The rendered homepage
 */
export default function HomePage(): ReactElement {
  const { health, isLoading, errorMessage } = useHealth();
  const healthIsUnreachable = errorMessage !== null;

  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Typography variant="h3" component="h1" gutterBottom>
        Hello World
      </Typography>

      <Box sx={{ mt: 4 }}>
        <Typography variant="overline" color="text.secondary" component="p">
          API health
        </Typography>

        {isLoading && <CircularProgress size={20} aria-label="Checking API health" />}

        {!isLoading && healthIsUnreachable && (
          <Alert severity="error">{errorMessage}</Alert>
        )}

        {/* `health !== null` is written inline rather than as a named boolean
            because TypeScript narrows on the inline check but not on an alias. */}
        {!isLoading && health !== null && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Chip color="success" label={health.status} />
            <Typography variant="body2" color="text.secondary">
              up {Math.round(health.uptime)}s
            </Typography>
          </Box>
        )}
      </Box>
    </Container>
  );
}
