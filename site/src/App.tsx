function App() {
  return (
    <div className="flex min-h-svh flex-col bg-bg text-text">
      <main className="mx-auto w-full max-w-3xl p-4 md:p-8">
        <h1 className="text-2xl font-medium">Resume</h1>
        <p className="mt-2 text-base text-muted">
          Site scaffold — content coming soon.
        </p>
        <div className="mt-6 rounded-card border border-border bg-surface p-4 dark:border-accent">
          <p className="text-sm text-muted">Design tokens</p>
          <p className="mt-1 text-accent">
            Light and dark palettes are wired to a{' '}
            <code className="font-mono">dark</code> class on{' '}
            <code className="font-mono">&lt;html&gt;</code>.
          </p>
        </div>
      </main>
    </div>
  )
}

export default App
