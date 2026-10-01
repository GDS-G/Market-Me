import { compileSourceSetup, type SourceSetupInput } from "@market-me/domain";
import styles from "./source-setup.module.css";

export function SourceSetupReview({ input, connectionName, contextNames }: {
  input: SourceSetupInput; connectionName: string; contextNames: readonly string[];
}) {
  const source = compileSourceSetup(input);
  return <section className={styles.review} aria-label="Proposed source setup">
    <h2>Review your source</h2>
    <p>This is a configuration review—not a scan, sample-content simulation, or cost estimate.</p>
    <dl>
      <div><dt>Name</dt><dd>{source.name}</dd></div>
      <div><dt>Connection</dt><dd>{connectionName}</dd></div>
      <div><dt>Selected location</dt><dd>{source.locations[0].displayPath}</dd></div>
      <div><dt>Subfolders</dt><dd>{source.recursive ? "Included inside the selected location" : "Not included"}</dd></div>
      <div><dt>File types</dt><dd>{input.fileTypes.join(", ")}</dd></div>
      <div><dt>Excluded folders</dt><dd>{input.ignoredFolders.length ? input.ignoredFolders.join(", ") : "None"}; temporary Office files are ignored.</dd></div>
      <div><dt>When content is ready</dt><dd>{source.readinessMode === "immediate" ? "Each eligible file after it settles"
        : source.readinessMode === "related_files" ? `Wait for at least ${source.relatedFileMinimum} related files`
          : `Wait for the ready marker “${source.readyMarker}”`}. Settling time: {source.stabilizationWindowSeconds} seconds.</dd></div>
      <div><dt>Context Packs</dt><dd>{contextNames.length ? contextNames.join("; ") : "None selected"}</dd></div>
      <div><dt>Behavior</dt><dd>{source.autonomyMode === "draft_only" ? "Draft only" : "Review required"}. No automatic publishing.</dd></div>
      <div><dt>Initial state</dt><dd>Paused. Nothing is scanned or queued by saving this setup.</dd></div>
    </dl>
    <div className={styles.notice}><strong>What happens next</strong><p>Save the paused source, test its configuration, and configure optional General Announcement preparation, copy controls and destinations. Enabling synchronization, approving content, preparing drafts and launching a Campaign remain separate actions.</p></div>
    <p>Folder access is not guaranteed by this summary. Saving rechecks your role, connection or desktop, and the Context Pack versions you selected. Context Packs remain linked to their current published versions for future processing.</p>
  </section>;
}
