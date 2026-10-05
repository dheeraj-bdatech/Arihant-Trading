'use client';

import React from 'react';
import { 
  MapPin, 
  Phone, 
  Mail, 
  TrendingUp, 
  Clock, 
  Navigation, 
  ShieldCheck, 
  CheckCircle2,
  ChevronRight
} from 'lucide-react';
import { ProductSpecItem } from '@/lib/brochure-products';

interface UnitTrackingCardProps {
  product: ProductSpecItem;
  className?: string;
  onCallOfficer?: () => void;
  onMessageOfficer?: () => void;
}

export function UnitTrackingCard({
  product,
  className = '',
  onCallOfficer,
  onMessageOfficer
}: UnitTrackingCardProps) {
  // Sample 30-day performance histogram bar heights (0 to 100)
  const barHeights = [
    45, 60, 55, 70, 85, 90, 75, 65, 80, 95, 
    88, 92, 70, 85, 90, 78, 82, 96, 90, 94, 
    85, 88, 92, 97, 89, 93, 91, 98, 95, 99
  ];

  return (
    <div className={`rounded-[14px] bg-white border border-[#DCD8CE] shadow-sm p-4 flex flex-col justify-between ${className}`}>
      {/* Unit Code and Live Status Badge */}
      <div className="flex items-center justify-between pb-3 border-b border-[#ECE9E2]">
        <div>
          <span className="font-mono text-base font-bold text-[#14213D] tracking-tight">
            {product.code}
          </span>
          <div className="text-[11px] text-[#4A5568] font-medium truncate max-w-[190px]">
            {product.name}
          </div>
        </div>

        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          {product.status}
        </span>
      </div>

      {/* Hardware Readiness & Deployment Location */}
      <div className="my-3 space-y-2.5">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="font-bold text-[#14213D]">Field Duty Logged</span>
          <span className="text-[#4A5568] flex items-center gap-1">
            <Clock className="w-3 h-3 text-[#0F5E63]" /> 148.5 Hours
          </span>
          <span className="font-semibold text-emerald-700">Calibrated</span>
        </div>

        {/* Readiness Progress Bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-[#4A5568] font-mono">
            <span>Operational Integrity</span>
            <span className="font-bold text-[#0F5E63]">{product.readiness}%</span>
          </div>
          <div className="relative w-full h-2 rounded-full bg-[#E3EFEE] overflow-hidden">
            <div 
              className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-[#0F5E63] to-emerald-600 rounded-full transition-all duration-1000"
              style={{ width: `${product.readiness}%` }}
            />
          </div>
        </div>

        {/* Depot and Active Deployment Outpost */}
        <div className="pt-1 space-y-1.5 text-xs text-[#14213D]">
          <div className="flex items-start gap-2">
            <MapPin className="w-3.5 h-3.5 text-[#0F5E63] mt-0.5 shrink-0" />
            <div className="min-w-0">
              <span className="text-[10px] text-[#4A5568] block">Assigned Logistics Base</span>
              <span className="font-medium text-[11px] truncate block">
                Patna HQ Central Ordnance Depot
              </span>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Navigation className="w-3.5 h-3.5 text-[#9A3412] mt-0.5 shrink-0" />
            <div className="min-w-0">
              <span className="text-[10px] text-[#4A5568] block">Current Deployment Outpost</span>
              <span className="font-semibold text-[11px] text-[#14213D] truncate block">
                Western Command · Sector 4 Airbase
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Total Performance 30-Day Histogram (Matching screenshot) */}
      <div className="pt-2 border-t border-[#ECE9E2]">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="font-semibold text-[#14213D]">Total Performance</span>
          <span className="text-[11px] text-[#4A5568]">last 30 days</span>
        </div>

        <div className="flex items-end justify-between gap-[2px] h-8 w-full">
          {barHeights.map((h, i) => (
            <div
              key={i}
              className={`w-full rounded-t-sm transition-all duration-300 ${
                i === barHeights.length - 1
                  ? 'bg-[#9A3412]'
                  : i >= 20
                  ? 'bg-[#0F5E63]'
                  : 'bg-[#C9C4B8]'
              }`}
              style={{ height: `${h}%` }}
              title={`Day ${i + 1}: ${h}%`}
            />
          ))}
          <span className="ml-2 font-mono text-sm font-bold text-[#14213D] shrink-0">
            {product.readiness}%
          </span>
        </div>
      </div>

      {/* Operator / Commander Contact Bar */}
      <div className="mt-3 pt-3 border-t border-[#ECE9E2] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-[#14213D] text-white flex items-center justify-center font-bold text-xs shadow-sm">
            RV
          </div>
          <div>
            <div className="text-xs font-bold text-[#14213D] leading-tight">
              Col. Rajesh Verma
            </div>
            <div className="text-[10px] text-[#4A5568]">EOD Ops Commander</div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onCallOfficer}
            title="Dispatch / Radio Call"
            className="p-1.5 rounded-lg border border-[#DCD8CE] text-[#14213D] hover:bg-[#E3EFEE] hover:text-[#0F5E63] transition-colors"
          >
            <Phone className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onMessageOfficer}
            title="Send Encrypted Message"
            className="p-1.5 rounded-lg border border-[#DCD8CE] text-[#14213D] hover:bg-[#E3EFEE] hover:text-[#0F5E63] transition-colors"
          >
            <Mail className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
