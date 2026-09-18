/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// ui
import { Button } from "@plane/propel/button";

// Module scope: this handler reads nothing from the component, so recreating it
// per render only churns the `onClick` identity.
function handleRetry() {
  window.location.reload();
}

function ErrorPage() {
  return (
    <div className="grid h-screen place-items-center bg-surface-1 p-4">
      <div className="space-y-8 text-center">
        <div className="space-y-2">
          <h3 className="text-16 font-semibold">Yikes! That doesn{"'"}t look good.</h3>
          <p className="mx-auto text-13 text-secondary md:w-1/2">
            That crashed Company Runner, pun intended. No worries, though. Our engineers have been notified. If you have
            more details, please write to{" "}
            <a href="mailto:support@plane.so" className="text-accent-primary">
              support@plane.so
            </a>{" "}
            or on our{" "}
            <a href="https://forum.plane.so" target="_blank" className="text-accent-primary" rel="noopener noreferrer">
              Forum
            </a>
            .
          </p>
        </div>
        <div className="flex items-center justify-center gap-2">
          <Button variant="primary" size="lg" onClick={handleRetry}>
            Refresh
          </Button>
          {/* <Button variant="secondary" size="lg" onClick={() => {}}>
            Sign out
          </Button> */}
        </div>
      </div>
    </div>
  );
}

export default ErrorPage;
