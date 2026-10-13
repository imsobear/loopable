import { createFileRoute } from "@tanstack/react-router";
import { CONTACT, LegalPage } from "@/landing/legal";
import { getViewer } from "@/server/functions/account.ts";

export const Route = createFileRoute("/terms")({
  beforeLoad: async () => ({ signedIn: Boolean((await getViewer()).viewer) }),
  head: () => ({ meta: [{ title: "Terms — Loopable" }] }),
  component: Terms,
});

function Terms() {
  const { signedIn } = Route.useRouteContext();
  return (
    <LegalPage signedIn={signedIn} title="Terms">
      <section>
        <p>
          These terms cover your use of Loopable at loop.goodone.si. By signing in you agree to them. How
          your data is handled is on the <a href="/privacy">Privacy</a> page.
        </p>
      </section>

      <section>
        <h2>The service</h2>
        <p>
          Loopable is early and offered as it is, without warranties. It may change, be interrupted, or
          lose data, so do not rely on it as the only record of anything. Each workspace has limits on
          how many loops and runners it can have, and how often a loop checks for work.
        </p>
      </section>

      <section>
        <h2>Your agent, your machine</h2>
        <p>
          The agent runs on your machine, with your accounts and your access. What it does there, and
          what a loop writes back to the services you connect, is your responsibility. Choose what a loop
          may do with that in mind, and keep your runner&apos;s join token private: anyone with it can
          add a runner to your workspace.
        </p>
      </section>

      <section>
        <h2>Fair use</h2>
        <ul>
          <li>Use Loopable only with accounts and services you are allowed to use.</li>
          <li>Do not use it to send spam, attack other systems, or break the rules of a connected service.</li>
          <li>Do not try to reach other people&apos;s workspaces or get around the limits.</li>
        </ul>
        <p>A workspace that does may be suspended or removed.</p>
      </section>

      <section>
        <h2>Liability</h2>
        <p>
          To the extent the law allows, Loopable is not liable for indirect or consequential losses, or
          for lost data, arising from using it.
        </p>
      </section>

      <section>
        <h2>Ending</h2>
        <p>
          You can stop using Loopable at any time and ask for your workspace to be deleted. If these
          terms change, the date above changes with them. Questions go to{" "}
          <a href={CONTACT}>GitHub issues</a>.
        </p>
      </section>
    </LegalPage>
  );
}
