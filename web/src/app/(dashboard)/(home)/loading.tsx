export default function DashboardLoading() {
  return (
    <div role="status" aria-label="Chargement" className="animate-pulse">
      <div className="h-4 w-36 rounded bg-white/10" />
      <div className="mt-3 h-11 w-80 max-w-full rounded-lg bg-white/10" />
      {/* Podium : la première place au centre, plus haute. */}
      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-end">
        <div className="panel h-60 lg:order-2 lg:h-72" />
        <div className="panel h-60 lg:order-1" />
        <div className="panel h-60 lg:order-3" />
      </div>
      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="panel h-24" />
        ))}
      </div>
      <div className="panel mt-8 h-16" />
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="panel h-64" />
        ))}
      </div>
    </div>
  );
}
