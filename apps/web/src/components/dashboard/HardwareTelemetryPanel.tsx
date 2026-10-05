'use client';

import React, { useEffect, useState } from 'react';
import { 
  Zap, 
  BatteryCharging, 
  ShieldCheck, 
  Radio, 
  Activity, 
  Gauge, 
  Cpu, 
  Sliders, 
  Wifi, 
  Eye, 
  Volume2, 
  Crosshair,
  Sparkles,
  Layers,
  Thermometer,
  Compass
} from 'lucide-react';
import { ProductSpecItem } from '@/lib/brochure-products';

interface HardwareTelemetryPanelProps {
  product: ProductSpecItem;
  className?: string;
}

export function HardwareTelemetryPanel({ product, className = '' }: HardwareTelemetryPanelProps) {
  // Live subtle telemetry oscillation for dynamic realism
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setPulse((p) => (p + 1) % 100);
    }, 1500);
    return () => clearInterval(timer);
  }, []);

  // Compute tool-specific telemetry values based on model3DType and product specs
  const getToolMetrics = () => {
    switch (product.model3DType) {
      case 'robot':
        return {
          metric1: {
            title: 'LiFePO4 Power Pack',
            value: `${92 + (pulse % 5)}%`,
            subtext: `${product.batteryLife || '6.5h'} Runtime Remaining`,
            badge: '48.2V Nominal',
            icon: BatteryCharging,
            color: 'emerald',
            progress: 94
          },
          metric2: {
            title: 'Manipulator Arm Load',
            value: `${(11.8 + (pulse % 10) * 0.1).toFixed(1)} kg`,
            subtext: 'Max Lift: 15.0 kg · 6-Axis',
            badge: '78% Grip Force',
            icon: Cpu,
            color: 'teal',
            progress: 78
          },
          metric3: {
            title: 'RF Control & Video Link',
            value: '99.8%',
            subtext: '-64 dBm · AES-256 Standoff',
            badge: '1080p 60fps',
            icon: Wifi,
            color: 'purple',
            progress: 99
          }
        };

      case 'scanner':
        return {
          metric1: {
            title: 'AERB Radiation Safety',
            value: '<0.08 µSv',
            subtext: 'AERB Safety Limit: 0.25 µSv',
            badge: '100% Safe',
            icon: ShieldCheck,
            color: 'emerald',
            progress: 98
          },
          metric2: {
            title: 'Inspection Throughput',
            value: '340/hr',
            subtext: 'Walk-through screening pace',
            badge: '3.5s Scan Time',
            icon: Activity,
            color: 'teal',
            progress: 85
          },
          metric3: {
            title: 'Threat AI Detection',
            value: '99.8%',
            subtext: 'Metallic, organic & ceramic',
            badge: 'Auto-Localization',
            icon: Crosshair,
            color: 'amber',
            progress: 99
          }
        };

      case 'spectrometer':
        return {
          metric1: {
            title: '785nm Solid State Laser',
            value: '300 mW',
            subtext: 'Temperature Stabilized',
            badge: 'Laser Active',
            icon: Sparkles,
            color: 'amber',
            progress: 92
          },
          metric2: {
            title: 'Chemical Match Confidence',
            value: `${(98.5 + (pulse % 12) * 0.1).toFixed(1)}%`,
            subtext: '14,000+ Threat Database',
            badge: '4.2s Fast ID',
            icon: Crosshair,
            color: 'emerald',
            progress: 98
          },
          metric3: {
            title: 'Sensor Battery Runtime',
            value: '8.0 Hours',
            subtext: 'Hot-swappable tactical pack',
            badge: 'MIL-STD-810H',
            icon: BatteryCharging,
            color: 'teal',
            progress: 88
          }
        };

      case 'detector':
        return {
          metric1: {
            title: 'Pulse Induction Field',
            value: 'Level 9/10',
            subtext: 'Deep penetration to 3.5m',
            badge: 'High Sensitivity',
            icon: Radio,
            color: 'teal',
            progress: 90
          },
          metric2: {
            title: 'Soil Mineralization Filter',
            value: 'Auto-Balanced',
            subtext: 'Conductive ground rejection',
            badge: 'Zero False Alarms',
            icon: Sliders,
            color: 'emerald',
            progress: 96
          },
          metric3: {
            title: 'Search Coil Submersion',
            value: 'IP68 Sealed',
            subtext: `${product.batteryLife || '25h'} Battery Life`,
            badge: 'Watertight',
            icon: ShieldCheck,
            color: 'purple',
            progress: 100
          }
        };

      case 'shield':
        return {
          metric1: {
            title: 'Ballistic Threat Level',
            value: 'NIJ Level IV',
            subtext: '7.62x54mmR AP Projectile',
            badge: 'Multi-Hit Rated',
            icon: ShieldCheck,
            color: 'emerald',
            progress: 100
          },
          metric2: {
            title: 'Viewport Transmittance',
            value: '92% Clarity',
            subtext: 'Anti-fragment polycarbonate',
            badge: 'Zero Distortion',
            icon: Eye,
            color: 'teal',
            progress: 92
          },
          metric3: {
            title: 'Tactical Trolley Chassis',
            value: `${product.weight || '36.5 kg'}`,
            subtext: 'Quick-detach assault rig',
            badge: 'All-Terrain Wheels',
            icon: Layers,
            color: 'amber',
            progress: 95
          }
        };

      default:
        return {
          metric1: {
            title: 'Sensor Sampling Rate',
            value: '1.0 Hz',
            subtext: 'Continuous real-time stream',
            badge: 'Class-1 Standard',
            icon: Activity,
            color: 'teal',
            progress: 92
          },
          metric2: {
            title: 'Hardware Readiness',
            value: `${product.readiness}%`,
            subtext: 'Pre-flight diagnostics verified',
            badge: 'Calibrated',
            icon: ShieldCheck,
            color: 'emerald',
            progress: product.readiness
          },
          metric3: {
            title: 'Cloud & Mesh Sync',
            value: 'BOS Cloud Online',
            subtext: '4G LTE / RF Mesh connected',
            badge: 'Encrypted',
            icon: Wifi,
            color: 'purple',
            progress: 98
          }
        };
    }
  };

  const metrics = getToolMetrics();

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Tool Telemetry Card 1 */}
      <div className="rounded-[14px] bg-white border border-[#DCD8CE] shadow-sm p-4 flex flex-col justify-between transition-all hover:border-[#0F5E63]/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#E3EFEE] text-[#0F5E63] flex items-center justify-center">
              <metrics.metric1.icon className="w-4 h-4" />
            </div>
            <span className="text-xs font-semibold text-[#14213D]">
              {metrics.metric1.title}
            </span>
          </div>
          <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            {metrics.metric1.badge}
          </span>
        </div>

        <div className="my-2.5">
          <div className="font-mono text-2xl font-bold text-[#14213D] tracking-tight">
            {metrics.metric1.value}
          </div>
          <div className="text-[11px] text-[#4A5568] mt-0.5">
            {metrics.metric1.subtext}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-1.5 rounded-full bg-[#ECE9E2] overflow-hidden">
          <div 
            className="h-full bg-emerald-600 rounded-full transition-all duration-700"
            style={{ width: `${metrics.metric1.progress}%` }}
          />
        </div>
      </div>

      {/* Tool Telemetry Card 2 */}
      <div className="rounded-[14px] bg-white border border-[#DCD8CE] shadow-sm p-4 flex flex-col justify-between transition-all hover:border-[#0F5E63]/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#FBEBDD] text-[#9A3412] flex items-center justify-center">
              <metrics.metric2.icon className="w-4 h-4" />
            </div>
            <span className="text-xs font-semibold text-[#14213D]">
              {metrics.metric2.title}
            </span>
          </div>
          <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-[#FBEBDD] text-[#9A3412] border border-[#9A3412]/20">
            {metrics.metric2.badge}
          </span>
        </div>

        <div className="my-2.5">
          <div className="font-mono text-2xl font-bold text-[#14213D] tracking-tight">
            {metrics.metric2.value}
          </div>
          <div className="text-[11px] text-[#4A5568] mt-0.5">
            {metrics.metric2.subtext}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-1.5 rounded-full bg-[#ECE9E2] overflow-hidden">
          <div 
            className="h-full bg-[#0F5E63] rounded-full transition-all duration-700"
            style={{ width: `${metrics.metric2.progress}%` }}
          />
        </div>
      </div>

      {/* Tool Telemetry Card 3 */}
      <div className="rounded-[14px] bg-white border border-[#DCD8CE] shadow-sm p-4 flex flex-col justify-between transition-all hover:border-[#0F5E63]/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#E3EFEE] text-[#0F5E63] flex items-center justify-center">
              <metrics.metric3.icon className="w-4 h-4" />
            </div>
            <span className="text-xs font-semibold text-[#14213D]">
              {metrics.metric3.title}
            </span>
          </div>
          <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-[#E3EFEE] text-[#0F5E63] border border-[#0F5E63]/20">
            {metrics.metric3.badge}
          </span>
        </div>

        <div className="my-2.5">
          <div className="font-mono text-2xl font-bold text-[#14213D] tracking-tight">
            {metrics.metric3.value}
          </div>
          <div className="text-[11px] text-[#4A5568] mt-0.5">
            {metrics.metric3.subtext}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-1.5 rounded-full bg-[#ECE9E2] overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-[#0F5E63] to-[#8B5CF6] rounded-full transition-all duration-700"
            style={{ width: `${metrics.metric3.progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
