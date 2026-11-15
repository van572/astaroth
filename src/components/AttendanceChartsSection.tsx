import { useMemo, useState } from 'react';
import { BarChart3, Clock, RefreshCw, TrendingUp, Users } from 'lucide-react';
import type { AnalyticsResponse } from '../types';
import { getLocalDateString } from '../utils/api';

interface AttendanceChartsSectionProps {
  analytics: AnalyticsResponse | null;
  loading: boolean;
  selectedDate: string;
  onDateChange: (date: string) => void;
  onRefresh: () => void;
}

export function AttendanceChartsSection({
  analytics,
  loading,
  selectedDate,
  onDateChange,
  onRefresh,
}: AttendanceChartsSectionProps) {
  const [hoveredDayIdx, setHoveredDayIdx] = useState<number | null>(null);
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);

  // Determine active hourly window (default 06:00-21:00, expanded automatically if scans occurred outside)
  const visibleHours = useMemo(() => {
    if (!analytics) return [];
    let minH = 6;
    let maxH = 21;
    for (const h of analytics.hourlyPeaks) {
      if (h.entries > 0 || h.exits > 0) {
        if (h.hour < minH) minH = h.hour;
        if (h.hour > maxH) maxH = h.hour;
      }
    }
    return analytics.hourlyPeaks.filter((h) => h.hour >= minH && h.hour <= maxH);
  }, [analytics]);

  const maxDailyValue = useMemo(() => {
    if (!analytics) return 4;
    let max = 0;
    for (const d of analytics.dailyTrends) {
      if (d.entries > max) max = d.entries;
      if (d.exits > max) max = d.exits;
    }
    return Math.max(4, max);
  }, [analytics]);

  const maxHourlyValue = useMemo(() => {
    let max = 0;
    for (const h of visibleHours) {
      if (h.entries > max) max = h.entries;
      if (h.exits > max) max = h.exits;
    }
    return Math.max(4, max);
  }, [visibleHours]);

  const summary = analytics?.summary;
  const attendanceRate =
    summary && summary.totalActive > 0
      ? Math.round((summary.presentToday / summary.totalActive) * 100)
      : 0;

  return (
    <div className="mt-6 space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-3.5">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-4 w-4 text-blue-700" />
          <span className="font-display text-sm font-bold text-slate-900">
            Resumen Analítico del Día
          </span>
          <span className="text-slate-300" aria-hidden="true">·</span>
          <input
            type="date"
            aria-label="Fecha del resumen visual"
            value={selectedDate}
            onChange={(e) => onDateChange(e.target.value || getLocalDateString())}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs font-medium text-slate-800 focus:border-blue-700 focus:outline-none"
          />
        </div>

        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Actualizar gráficos
        </button>
      </div>

      {/* 4-Column KPI Summary Strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <span className="text-xs text-slate-500">Asistencia del día</span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-slate-900 tabular-nums">
              {summary ? `${summary.presentToday}/${summary.totalActive}` : '0/0'}
            </span>
            <span className="font-mono text-xs font-semibold text-emerald-700 tabular-nums">
              ({attendanceRate}%)
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <span className="text-xs text-slate-500">En jornada actualmente</span>
          <div className="mt-1 font-mono text-2xl font-bold text-emerald-700 tabular-nums">
            {summary?.currentlyOnSite ?? 0}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <span className="text-xs text-slate-500">Hora pico de entrada</span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-blue-700 tabular-nums">
              {summary?.peakEntryHour ?? '—'}
            </span>
            {summary && summary.peakEntryCount > 0 && (
              <span className="text-xs text-slate-500 tabular-nums">
                ({summary.peakEntryCount} ingresos)
              </span>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <span className="text-xs text-slate-500">Total lecturas ({selectedDate})</span>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
            {summary?.totalScansToday ?? 0}
          </div>
        </div>
      </div>

      {loading && !analytics ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="h-72 animate-pulse rounded-xl border border-slate-200 bg-white" />
          <div className="h-72 animate-pulse rounded-xl border border-slate-200 bg-white" />
        </div>
      ) : (
        <>
          {/* Row 1: 7-Day Trend + Hourly Entry Peaks */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Chart 1: 7-Day Attendance Trends */}
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="flex items-center gap-2 font-display text-base font-bold text-slate-900">
                    <TrendingUp className="h-4 w-4 text-blue-700" />
                    Tendencia de Asistencia (7 días)
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Comparativa diaria de entradas y salidas hasta {selectedDate}
                  </p>
                </div>

                <div className="flex items-center gap-4 text-xs text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-xs bg-emerald-600" />
                    Entradas
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-xs bg-blue-700" />
                    Salidas
                  </span>
                </div>
              </div>

              <div className="relative mt-5">
                {analytics && (
                  <svg
                    viewBox="0 0 560 220"
                    className="h-56 w-full overflow-visible"
                    role="img"
                    aria-label="Gráfico de tendencia de asistencia en los últimos 7 días"
                  >
                    {/* Horizontal gridlines */}
                    {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                      const y = 180 - ratio * 150;
                      const tickVal = Math.round(maxDailyValue * ratio);
                      return (
                        <g key={ratio}>
                          <line
                            x1={38}
                            y1={y}
                            x2={548}
                            y2={y}
                            stroke="#e2e8f0"
                            strokeWidth={1}
                            strokeDasharray={ratio === 0 ? undefined : '3 3'}
                          />
                          <text
                            x={30}
                            y={y + 4}
                            textAnchor="end"
                            className="fill-slate-400 font-mono text-[10px]"
                          >
                            {tickVal}
                          </text>
                        </g>
                      );
                    })}

                    {/* Grouped bars per day */}
                    {analytics.dailyTrends.map((d, idx) => {
                      const slotWidth = (548 - 44) / analytics.dailyTrends.length;
                      const centerX = 44 + slotWidth * idx + slotWidth / 2;
                      const barW = 16;
                      const entryH = (d.entries / maxDailyValue) * 150;
                      const exitH = (d.exits / maxDailyValue) * 150;
                      const isHovered = hoveredDayIdx === idx;
                      const isTarget = d.date === selectedDate;

                      return (
                        <g
                          key={d.date}
                          onMouseEnter={() => setHoveredDayIdx(idx)}
                          onMouseLeave={() => setHoveredDayIdx(null)}
                          className="cursor-pointer"
                        >
                          {isHovered && (
                            <rect
                              x={centerX - slotWidth / 2 + 4}
                              y={20}
                              width={slotWidth - 8}
                              height={160}
                              rx={6}
                              fill="#f1f5f9"
                            />
                          )}

                          {/* Entry bar */}
                          <rect
                            x={centerX - barW - 2}
                            y={180 - entryH}
                            width={barW}
                            height={Math.max(entryH, d.entries > 0 ? 3 : 0)}
                            rx={3}
                            fill="#16a34a"
                          />
                          {/* Exit bar */}
                          <rect
                            x={centerX + 2}
                            y={180 - exitH}
                            width={barW}
                            height={Math.max(exitH, d.exits > 0 ? 3 : 0)}
                            rx={3}
                            fill="#1d4ed8"
                          />

                          <text
                            x={centerX}
                            y={198}
                            textAnchor="middle"
                            className={`font-mono text-[10px] ${
                              isTarget ? 'fill-slate-900 font-bold' : 'fill-slate-500'
                            }`}
                          >
                            {d.label}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                )}

                {/* Hover Summary Line */}
                <div className="mt-2 flex h-6 items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-600 tabular-nums">
                  {hoveredDayIdx !== null && analytics?.dailyTrends[hoveredDayIdx] ? (
                    <>
                      <span className="font-mono font-semibold text-slate-900">
                        {analytics.dailyTrends[hoveredDayIdx].date}
                      </span>
                      <span>
                        Entradas: <strong className="text-emerald-700">{analytics.dailyTrends[hoveredDayIdx].entries}</strong>
                        <span className="mx-2 text-slate-300">·</span>
                        Salidas: <strong className="text-blue-700">{analytics.dailyTrends[hoveredDayIdx].exits}</strong>
                        <span className="mx-2 text-slate-300">·</span>
                        Personas únicas: <strong className="text-slate-900">{analytics.dailyTrends[hoveredDayIdx].uniquePeople}</strong>
                      </span>
                    </>
                  ) : (
                    <span className="text-slate-400">
                      Pase el cursor sobre un día para ver el detalle de asistencia.
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Chart 2: Hourly Entry Peaks */}
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="flex items-center gap-2 font-display text-base font-bold text-slate-900">
                    <Clock className="h-4 w-4 text-blue-700" />
                    Horas Pico de Entrada ({selectedDate})
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Distribución horaria de ingresos y salidas registradas
                  </p>
                </div>

                <div className="flex items-center gap-4 text-xs text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-xs bg-blue-700" />
                    Ingresos/h
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-xs bg-amber-500" />
                    Hora pico
                  </span>
                </div>
              </div>

              <div className="relative mt-5">
                {visibleHours.length > 0 && (
                  <svg
                    viewBox="0 0 560 220"
                    className="h-56 w-full overflow-visible"
                    role="img"
                    aria-label="Gráfico de horas pico de entrada durante el día"
                  >
                    {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                      const y = 180 - ratio * 150;
                      const tickVal = Math.round(maxHourlyValue * ratio);
                      return (
                        <g key={ratio}>
                          <line
                            x1={38}
                            y1={y}
                            x2={548}
                            y2={y}
                            stroke="#e2e8f0"
                            strokeWidth={1}
                            strokeDasharray={ratio === 0 ? undefined : '3 3'}
                          />
                          <text
                            x={30}
                            y={y + 4}
                            textAnchor="end"
                            className="fill-slate-400 font-mono text-[10px]"
                          >
                            {tickVal}
                          </text>
                        </g>
                      );
                    })}

                    {visibleHours.map((h, idx) => {
                      const slotWidth = (548 - 44) / visibleHours.length;
                      const centerX = 44 + slotWidth * idx + slotWidth / 2;
                      const barW = Math.max(10, Math.min(22, slotWidth * 0.58));
                      const barH = (h.entries / maxHourlyValue) * 150;
                      const isPeak =
                        summary?.peakEntryCount &&
                        summary.peakEntryCount > 0 &&
                        h.entries === summary.peakEntryCount;
                      const isHovered = hoveredHour === h.hour;

                      return (
                        <g
                          key={h.hour}
                          onMouseEnter={() => setHoveredHour(h.hour)}
                          onMouseLeave={() => setHoveredHour(null)}
                          className="cursor-pointer"
                        >
                          {isHovered && (
                            <rect
                              x={centerX - slotWidth / 2 + 2}
                              y={20}
                              width={slotWidth - 4}
                              height={160}
                              rx={4}
                              fill="#f1f5f9"
                            />
                          )}

                          <rect
                            x={centerX - barW / 2}
                            y={180 - barH}
                            width={barW}
                            height={Math.max(barH, h.entries > 0 ? 3 : 0)}
                            rx={3}
                            fill={isPeak ? '#d97706' : '#1d4ed8'}
                          />

                          {(idx % 2 === 0 || visibleHours.length <= 12) && (
                            <text
                              x={centerX}
                              y={198}
                              textAnchor="middle"
                              className={`font-mono text-[10px] ${
                                isPeak ? 'fill-amber-700 font-bold' : 'fill-slate-500'
                              }`}
                            >
                              {String(h.hour).padStart(2, '0')}h
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                )}

                <div className="mt-2 flex h-6 items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-600 tabular-nums">
                  {hoveredHour !== null ? (
                    (() => {
                      const bucket = visibleHours.find((v) => v.hour === hoveredHour);
                      if (!bucket) return null;
                      return (
                        <>
                          <span className="font-mono font-semibold text-slate-900">
                            Franja {bucket.label} – {String(bucket.hour).padStart(2, '0')}:59
                          </span>
                          <span>
                            Entradas: <strong className="text-blue-700">{bucket.entries}</strong>
                            <span className="mx-2 text-slate-300">·</span>
                            Salidas: <strong className="text-slate-800">{bucket.exits}</strong>
                          </span>
                        </>
                      );
                    })()
                  ) : (
                    <span className="text-slate-400">
                      Pase el cursor sobre una franja horaria para inspeccionar entradas y salidas.
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Row 2: Department Distribution Today */}
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h2 className="flex items-center gap-2 font-display text-base font-bold text-slate-900">
                  <Users className="h-4 w-4 text-blue-700" />
                  Distribución de Personal por Departamento ({selectedDate})
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Personal presente en el día frente al total de carnets activos por área
                </p>
              </div>

              <div className="flex items-center gap-4 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-xs bg-emerald-600" />
                  En jornada ahora
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-xs bg-blue-600" />
                  Presentes hoy
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-xs bg-slate-200" />
                  Total activos
                </span>
              </div>
            </div>

            {!analytics || analytics.departmentDistribution.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-500">
                No hay departamentos con personal activo registrado para graficar.
              </p>
            ) : (
              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                {analytics.departmentDistribution.map((dept) => {
                  const presentPct =
                    dept.totalActive > 0
                      ? Math.round((dept.presentToday / dept.totalActive) * 100)
                      : 0;
                  const onSitePct =
                    dept.totalActive > 0
                      ? Math.round((dept.currentlyOnSite / dept.totalActive) * 100)
                      : 0;

                  return (
                    <div
                      key={dept.department}
                      className="rounded-lg border border-slate-200 bg-slate-50/50 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate font-display text-sm font-bold text-slate-900">
                          {dept.department}
                        </span>
                        <span className="font-mono text-xs font-semibold text-slate-700 tabular-nums whitespace-nowrap shrink-0">
                          {dept.presentToday}/{dept.totalActive} ({presentPct}%)
                        </span>
                      </div>

                      {/* Stacked progress track */}
                      <div className="relative mt-2.5 h-3 w-full overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="absolute inset-y-0 left-0 bg-blue-600 transition-all duration-200"
                          style={{ width: `${presentPct}%` }}
                        />
                        <div
                          className="absolute inset-y-0 left-0 bg-emerald-600 transition-all duration-200"
                          style={{ width: `${onSitePct}%` }}
                        />
                      </div>

                      <div className="mt-2 flex items-center justify-between text-xs text-slate-500 tabular-nums">
                        <span>En jornada: {dept.currentlyOnSite}</span>
                        <span>Con ingreso hoy: {dept.presentToday}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
