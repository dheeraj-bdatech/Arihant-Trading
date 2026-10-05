'use client';

import React, { useState } from 'react';
import { Calendar, TrendingUp } from 'lucide-react';
import { formatINR } from '@arihant/shared';

interface RevenueSplineChartProps {
  totalValue?: number;
  periodValue?: number;
  periodLabel?: string;
  className?: string;
}

export function RevenueSplineChart({
  totalValue = 1920000,
  periodValue = 1430000,
  periodLabel = '1 Sep - 8 Sep',
  className = ''
}: RevenueSplineChartProps) {
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);

  // Normalized data coordinates (X: 0..300, Y: 10..75)
  const points = [
    { x: 15, y: 55, date: '1 Sep', val: '₹1.8L' },
    { x: 65, y: 35, date: '2 Sep', val: '₹2.9L' },
    { x: 120, y: 62, date: '4 Sep', val: '₹1.5L' },
    { x: 180, y: 22, date: '6 Sep', val: '₹4.2L' },
    { x: 235, y: 38, date: '7 Sep', val: '₹3.1L' },
    { x: 285, y: 15, date: '8 Sep', val: '₹5.7L' },
  ];

  // Build smooth cubic bezier SVG path
  // M x0,y0 C cp1x,cp1y cp2x,cp2y x1,y1 ...
  const splinePath = "M 15,55 C 40,55 45,35 65,35 C 85,35 95,62 120,62 C 145,62 160,22 180,22 C 205,22 215,38 235,38 C 255,38 265,15 285,15";
  const areaPath = `${splinePath} L 285,85 L 15,85 Z`;

  return (
    <div className={`rounded-[14px] bg-white border border-[#DCD8CE] shadow-sm p-4 flex flex-col justify-between ${className}`}>
      {/* Header with Metric & Date Period */}
      <div className="flex items-start justify-between">
        <div>
          <span className="text-xs font-semibold text-[#4A5568]">Fleet Valuation &amp; Deployment Trend</span>
          <div className="font-mono text-2xl font-bold text-[#14213D] mt-0.5 tracking-tight">
            {formatINR(totalValue)}
          </div>
        </div>

        <div className="text-right">
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#E3EFEE] text-[#0F5E63] text-[10px] font-mono font-medium">
            <Calendar className="w-3 h-3" />
            <span>{periodLabel}</span>
          </div>
          <div className="font-mono text-xs font-semibold text-[#0F5E63] mt-1">
            Allocated: {formatINR(periodValue)}
          </div>
        </div>
      </div>

      {/* Smooth Bézier Spline Chart Container */}
      <div className="relative my-2 h-20 w-full overflow-visible">
        <svg 
          viewBox="0 0 300 85" 
          preserveAspectRatio="none" 
          className="w-full h-full overflow-visible"
        >
          <defs>
            <linearGradient id="splineGradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#8B5CF6" />
              <stop offset="50%" stopColor="#3B82F6" />
              <stop offset="100%" stopColor="#0F5E63" />
            </linearGradient>
            <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#0F5E63" stopOpacity="0.01" />
            </linearGradient>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Underfill Area */}
          <path d={areaPath} fill="url(#areaGradient)" />

          {/* Gradient Spline Curve */}
          <path 
            d={splinePath} 
            fill="none" 
            stroke="url(#splineGradient)" 
            strokeWidth="2.5" 
            strokeLinecap="round"
            filter="url(#glow)"
          />

          {/* Interactive Data Nodes */}
          {points.map((pt, idx) => (
            <g key={idx} className="cursor-pointer">
              <circle
                cx={pt.x}
                cy={pt.y}
                r={hoveredPoint === idx ? 5 : 3.5}
                fill="#FFFFFF"
                stroke="#8B5CF6"
                strokeWidth="2"
                className="transition-all duration-150"
                onMouseEnter={() => setHoveredPoint(idx)}
                onMouseLeave={() => setHoveredPoint(null)}
              />
              {hoveredPoint === idx && (
                <g>
                  <rect
                    x={pt.x - 28}
                    y={pt.y - 24}
                    width="56"
                    height="18"
                    rx="4"
                    fill="#14213D"
                  />
                  <text
                    x={pt.x}
                    y={pt.y - 12}
                    textAnchor="middle"
                    fill="#FFFFFF"
                    fontSize="9"
                    fontFamily="monospace"
                  >
                    {pt.val}
                  </text>
                </g>
              )}
            </g>
          ))}
        </svg>
      </div>

      {/* Footer Info */}
      <div className="pt-2 border-t border-[#ECE9E2] flex items-center justify-between text-[11px] text-[#4A5568]">
        <span className="flex items-center gap-1 text-emerald-600 font-semibold font-mono">
          <TrendingUp className="w-3.5 h-3.5" /> +14.8% vs last week
        </span>
        <span className="font-mono text-[#14213D]">Daily Log Active</span>
      </div>
    </div>
  );
}
