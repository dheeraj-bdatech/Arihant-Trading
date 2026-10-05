'use client';

import React, { useState } from 'react';
import { MapPin, Navigation, Compass, Layers, ShieldCheck } from 'lucide-react';

interface TacticalIndiaMapProps {
  className?: string;
  totalDeployments?: number;
  onTimeRate?: string;
}

export function TacticalIndiaMap({
  className = '',
  totalDeployments = 38450,
  onTimeRate = '98.6%'
}: TacticalIndiaMapProps) {
  const [selectedRegion, setSelectedRegion] = useState('All Hubs');
  const [hoveredHub, setHoveredHub] = useState<string | null>(null);

  // Strategic Deployment Hubs based on Arihant Brochure HQ & Key Offices
  const hubs = [
    { id: 'patna', name: 'Patna HQ', state: 'Bihar', x: 235, y: 135, units: 1420, type: 'hq', status: 'Central Command' },
    { id: 'delhi', name: 'Delhi NCR Hub', state: 'Delhi', x: 145, y: 95, units: 2890, type: 'high', status: 'Aviation & Paramilitary' },
    { id: 'kolkata', name: 'Kolkata Hub', state: 'West Bengal', x: 265, y: 160, units: 980, type: 'high', status: 'Eastern Borders' },
    { id: 'assam', name: 'Guwahati Depot', state: 'Assam', x: 310, y: 115, units: 740, type: 'border', status: 'North East BDDS' },
    { id: 'punjab', name: 'Pathankot Base', state: 'Punjab', x: 120, y: 60, units: 820, type: 'border', status: 'Border Tactical Post' },
    { id: 'rajasthan', name: 'Jodhpur Depot', state: 'Rajasthan', x: 95, y: 125, units: 610, type: 'border', status: 'Desert Recon Unit' },
    { id: 'mumbai', name: 'Mumbai Port Area', state: 'Maharashtra', x: 105, y: 205, units: 1540, type: 'high', status: 'Port & Customs' },
    { id: 'bengaluru', name: 'Southern Tech Hub', state: 'Karnataka', x: 140, y: 265, units: 890, type: 'high', status: 'Critical Infra' }
  ];

  return (
    <div className={`rounded-[14px] bg-white border border-[#DCD8CE] shadow-sm p-4 flex flex-col justify-between ${className}`}>
      {/* Top Header with Title and Region Dropdown (Matching reference image) */}
      <div className="flex items-center justify-between pb-2 border-b border-[#ECE9E2]">
        <div>
          <h3 className="font-serif font-bold text-base text-[#14213D]">
            Distribution & Tactical Deployments
          </h3>
          <p className="text-[11px] text-[#4A5568]">Pan-India Defence & Security Installations</p>
        </div>

        <select
          value={selectedRegion}
          onChange={(e) => setSelectedRegion(e.target.value)}
          aria-label="Filter deployment regions"
          className="text-xs font-mono font-medium text-[#14213D] bg-[#FBFAF7] border border-[#C9C4B8] rounded-lg px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-[#0F5E63]"
        >
          <option value="All Hubs">All India (100+ Projects)</option>
          <option value="Eastern">Eastern Command (Patna/Kolkata)</option>
          <option value="Northern">Northern Borders (Punjab/Delhi)</option>
          <option value="Western">Western Defense (Rajasthan/Mumbai)</option>
        </select>
      </div>

      {/* Map Viewport Area */}
      <div className="relative my-3 flex items-center justify-center min-h-[220px]">
        {/* Floating Stat Badge (Matching 2,561 shipments badge in reference image) */}
        <div className="absolute top-2 left-4 z-10 px-3 py-1.5 rounded-lg bg-[#14213D] text-white shadow-md text-xs font-mono flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
          <span>2,561 Active Deployments</span>
        </div>

        {/* Tactical India Contour SVG Vector */}
        <svg
          viewBox="0 0 380 320"
          className="w-full h-56 max-w-sm select-none"
        >
          <defs>
            <radialGradient id="mapRadarGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#0F5E63" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#0F5E63" stopOpacity="0.0" />
            </radialGradient>
          </defs>

          {/* Contour Silhouette */}
          <circle cx="180" cy="160" r="140" fill="url(#mapRadarGlow)" />
          <path
            d="M 120 45 L 145 35 L 160 55 L 175 60 L 155 85 L 170 95 L 210 100 L 260 95 L 310 90 L 340 105 L 310 135 L 275 140 L 270 180 L 220 220 L 180 270 L 155 310 L 140 280 L 120 220 L 95 190 L 80 150 L 90 105 L 110 80 Z"
            fill="#F6F5F1"
            stroke="#DCD8CE"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />

          {/* Radar Circles */}
          <circle cx="180" cy="160" r="40" fill="none" stroke="#ECE9E2" strokeDasharray="3 3" />
          <circle cx="180" cy="160" r="90" fill="none" stroke="#ECE9E2" strokeDasharray="3 3" />

          {/* Hub Pins and Beacons */}
          {hubs.map((hub) => {
            const isHovered = hoveredHub === hub.id;
            const isHQ = hub.type === 'hq';

            return (
              <g
                key={hub.id}
                className="cursor-pointer transition-all duration-200"
                onMouseEnter={() => setHoveredHub(hub.id)}
                onMouseLeave={() => setHoveredHub(null)}
              >
                {/* Ping ring */}
                <circle
                  cx={hub.x}
                  cy={hub.y}
                  r={isHovered ? 12 : 7}
                  fill={isHQ ? '#9A3412' : '#0F5E63'}
                  fillOpacity="0.25"
                  className={isHQ ? 'animate-ping' : ''}
                />
                {/* Core dot */}
                <circle
                  cx={hub.x}
                  cy={hub.y}
                  r={isHovered ? 5 : 3.5}
                  fill={isHQ ? '#9A3412' : '#0F5E63'}
                  stroke="#FFFFFF"
                  strokeWidth="1.5"
                />

                {/* Hub Tooltip */}
                {isHovered && (
                  <g>
                    <rect
                      x={hub.x - 45}
                      y={hub.y - 32}
                      width="90"
                      height="24"
                      rx="4"
                      fill="#14213D"
                    />
                    <text
                      x={hub.x}
                      y={hub.y - 18}
                      textAnchor="middle"
                      fill="#FFFFFF"
                      fontSize="9"
                      fontWeight="bold"
                    >
                      {hub.name}
                    </text>
                    <text
                      x={hub.x}
                      y={hub.y - 9}
                      textAnchor="middle"
                      fill="#F2B872"
                      fontSize="8"
                      fontFamily="monospace"
                    >
                      {hub.units} units deployed
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Footer Metrics (Matching Total shipments / On-time delivery in reference image) */}
      <div className="pt-3 border-t border-[#ECE9E2] flex items-center justify-between">
        <div>
          <div className="text-[11px] text-[#4A5568]">Total Deployments</div>
          <div className="font-mono text-xl font-bold text-[#14213D]">
            {totalDeployments.toLocaleString()}
          </div>
        </div>

        <div>
          <div className="text-[11px] text-[#4A5568]">On-Time Readiness</div>
          <div className="font-mono text-xl font-bold text-emerald-700">
            {onTimeRate}
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-col gap-1 text-[11px] font-mono text-[#4A5568]">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#0F5E63]"></span>
            <span>High Volume Command</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#9A3412]"></span>
            <span>HQ & Strategic Outpost</span>
          </div>
        </div>
      </div>
    </div>
  );
}
