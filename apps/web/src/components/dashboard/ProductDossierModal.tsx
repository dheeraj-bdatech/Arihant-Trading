'use client';

import React from 'react';
import { 
  X, 
  ShieldCheck, 
  FileText, 
  Download, 
  CheckCircle2, 
  Box, 
  Layers, 
  ExternalLink,
  Cpu,
  Activity,
  Share2
} from 'lucide-react';
import { ProductSpecItem } from '@/lib/brochure-products';

interface ProductDossierModalProps {
  product: ProductSpecItem | null;
  onClose: () => void;
}

export function ProductDossierModal({ product, onClose }: ProductDossierModalProps) {
  if (!product) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl border border-[#DCD8CE] shadow-2xl p-6 lg:p-8 space-y-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          aria-label="Close dossier modal"
          className="absolute top-5 right-5 p-2 rounded-xl text-[#4A5568] hover:text-[#14213D] hover:bg-[#F6F5F1] transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pr-8 border-b border-[#ECE9E2] pb-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-[#0F5E63] bg-[#E3EFEE] px-2.5 py-1 rounded-md">
                {product.code}
              </span>
              <span className="text-xs font-semibold text-[#4A5568] uppercase tracking-wider">
                {product.category}
              </span>
            </div>
            <h2 className="text-xl lg:text-2xl font-serif font-bold text-[#14213D]">
              {product.name}
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {product.isMhaQr && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FBEBDD] text-[#9A3412] border border-[#9A3412]/30 text-xs font-medium">
                <ShieldCheck className="w-4 h-4" /> MHA QR Approved
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium">
              <Activity className="w-3.5 h-3.5" /> {product.readiness}% Operational
            </span>
          </div>
        </div>

        {/* Content Layout: Image + Overview */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
          {/* Transparent Render */}
          <div className="md:col-span-5 flex items-center justify-center p-6 bg-gradient-to-b from-[#FAF9F6] to-[#ECEAE3] rounded-xl border border-[#DCD8CE]">
            <img
              src={product.image}
              alt={product.name}
              className="max-h-56 max-w-full object-contain filter drop-shadow-md"
            />
          </div>

          {/* Quick Specs & Description */}
          <div className="md:col-span-7 space-y-4">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#4A5568] mb-1">
                Operational Purpose
              </h4>
              <p className="text-xs text-[#14213D] leading-relaxed">
                {product.description}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-lg bg-[#FBFAF7] border border-[#ECE9E2]">
                <div className="text-[10px] text-[#4A5568]">Manufacturer / OEM</div>
                <div className="font-semibold text-[#14213D] mt-0.5">{product.make}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-[#FBFAF7] border border-[#ECE9E2]">
                <div className="text-[10px] text-[#4A5568]">Specification Standard</div>
                <div className="font-mono font-semibold text-[#0F5E63] mt-0.5">{product.specRef}</div>
              </div>
              {product.batteryLife && (
                <div className="p-2.5 rounded-lg bg-[#FBFAF7] border border-[#ECE9E2]">
                  <div className="text-[10px] text-[#4A5568]">Battery Endurance</div>
                  <div className="font-medium text-[#14213D] mt-0.5">{product.batteryLife}</div>
                </div>
              )}
              {product.weight && (
                <div className="p-2.5 rounded-lg bg-[#FBFAF7] border border-[#ECE9E2]">
                  <div className="text-[10px] text-[#4A5568]">Chassis Weight</div>
                  <div className="font-medium text-[#14213D] mt-0.5">{product.weight}</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Key Features from Brochure */}
        <div className="space-y-2.5">
          <h4 className="text-xs font-bold uppercase tracking-wider text-[#4A5568]">
            Key Tactical Features
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {product.features.map((feat, i) => (
              <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-[#FBFAF7] border border-[#ECE9E2] text-xs">
                <CheckCircle2 className="w-4 h-4 text-[#0F5E63] shrink-0 mt-0.5" />
                <span className="text-[#14213D]">{feat}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Detailed Technical Parameters Table */}
        <div className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-[#4A5568]">
            Technical Parameters & Specifications
          </h4>
          <div className="rounded-xl border border-[#ECE9E2] overflow-hidden">
            <table className="w-full text-left text-xs divide-y divide-[#ECE9E2]">
              <tbody className="divide-y divide-[#ECE9E2]">
                {product.keySpecs.map((spec, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-[#FBFAF7]'}>
                    <td className="py-2.5 px-4 font-medium text-[#4A5568] w-1/3">
                      {spec.label}
                    </td>
                    <td className="py-2.5 px-4 font-mono font-semibold text-[#14213D]">
                      {spec.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-[#ECE9E2]">
          <div className="text-[11px] text-[#4A5568] flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Official ATC Defence Brochure Release v2026</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => alert(`Brochure specification packet for ${product.name} downloaded.`)}
              className="px-4 py-2 rounded-xl bg-[#0F5E63] hover:bg-[#0B4A4E] text-white font-medium text-xs flex items-center gap-2 shadow-sm transition-colors"
            >
              <Download className="w-4 h-4" /> Download PDF Spec Sheet
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-[#DCD8CE] text-[#14213D] hover:bg-[#FBFAF7] font-medium text-xs transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
