import { createFileRoute } from "@tanstack/react-router";
import { CONTACT, LegalPage } from "@/landing/legal";
import { getViewer } from "@/server/functions/account.ts";

export const Route = createFileRoute("/privacy")({
  beforeLoad: async () => ({ signedIn: Boolean((await getViewer()).viewer) }),
  head: () => ({ meta: [{ title: "Privacy — Loopable" }] }),
  component: Privacy,
});

function Privacy() {
  const { signedIn } = Route.useRouteContext();
  return (
    <LegalPage signedIn={signedIn} title="Privacy">
      <section>
        <p>
          Loopable runs workflows for your coding agent. The service at loop.goodone.si holds your loops,
          your connections and the record of each run; the agent itself runs on your own machine. This
          page says what Loopable keeps, why, and how to have it removed.
        </p>
      </section>

      <section>
        <h2>What Loopable keeps</h2>
        <ul>
          <li>
            <strong>Your account.</strong> The id, name, login or email address and picture that GitHub
            or Google gives when you sign in. Signing in asks for nothing else.
          </li>
          <li>
            <strong>Connections.</strong> The tokens for the services you connect, such as GitHub, a
            Slack or Lark bot, or Gmail. They are encrypted, used only to read what your loops watch for
            and to write back what a loop asks, and never handed to the agent.
          </li>
          <li>
            <strong>Runs.</strong> For each run: what came in (an issue, a pull request, a message, an
            email), the prompt sent to your agent, the agent&apos;s answer and its log, and what was
            written back. This is your Inbox.
          </li>
          <li>
            <strong>Runners.</strong> Each machine you connect: its name, which agents it has and its
            version.
          </li>
          <li>
            <strong>Service logs.</strong> Requests to the service, kept by Cloudflare for a short time
            to run and secure it.
          </li>
        </ul>
        <p>
          Your code, files and network stay on your machine. Only what the agent puts in its answer and
          log comes back to Loopable.
        </p>
      </section>

      <section>
        <h2>Google user data</h2>
        <p>
          When you connect Gmail, Loopable reads messages in that inbox that match a loop you turned on,
          to start a run with them, and sends email when a loop you set up asks it to. Signing in with
          Google gives Loopable only your name, email address and picture.
        </p>
        <p>
          Loopable&apos;s use and transfer to any other app of information received from Google APIs
          will adhere to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. Google user data is not used for advertising, not
          sold, not used to train models, and not read by people except to fix a problem you report,
          for security, or where the law requires it.
        </p>
      </section>

      <section>
        <h2>Who else handles it</h2>
        <ul>
          <li>Cloudflare, which hosts the service.</li>
          <li>Turso, which hosts the database.</li>
          <li>
            The services you connect, when Loopable reads from or writes to them on your behalf, and the
            agent on your machine, which receives the prompt of each run.
          </li>
        </ul>
        <p>Nothing is sold, and nothing is shared for advertising.</p>
      </section>

      <section>
        <h2>Keeping and deleting</h2>
        <ul>
          <li>Removing a connection deletes its tokens, and revokes them where the service allows.</li>
          <li>Deleting a loop deletes its runs.</li>
          <li>
            To have your account and everything in your workspace deleted, ask through{" "}
            <a href={CONTACT}>GitHub issues</a>. You can also revoke Loopable&apos;s access at any time
            from your GitHub or Google account settings.
          </li>
        </ul>
      </section>

      <section>
        <h2>Changes and contact</h2>
        <p>
          If this changes, the date above changes with it. Questions go to{" "}
          <a href={CONTACT}>GitHub issues</a>.
        </p>
      </section>
    </LegalPage>
  );
}
