'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { 
  Shield, 
  FileText, 
  Layers, 
  Sparkles, 
  Radio, 
  Activity, 
  CheckCircle2, 
  Download, 
  Compass, 
  Search,
  Box,
  Eye,
  ChevronRight
} from 'lucide-react';
import { PageContainer, PageHeader, Button } from '@/components/ui';
import { 
  BROCHURE_PRODUCTS, 
  BROCHURE_CATEGORIES, 
  BROCHURE_STATS, 
  type ProductSpecItem 
} from '@/lib/brochure-products';
import { Equipment3DViewer } from '@/components/dashboard/Equipment3DViewer';
import { HardwareTelemetryPanel } from '@/components/dashboard/HardwareTelemetryPanel';
import { RevenueSplineChart } from '@/components/dashboard/RevenueSplineChart';
import { UnitTrackingCard } from '@/components/dashboard/UnitTrackingCard';
import { EquipmentSelectorStrip } from '@/components/dashboard/EquipmentSelectorStrip';
import { TacticalIndiaMap } from '@/components/dashboard/TacticalIndiaMap';
import { DeploymentsTable } from '@/components/dashboard/DeploymentsTable';
import { ProductDossierModal } from '@/components/dashboard/ProductDossierModal';

export default function ProductsPage() {
  const [selectedProduct, setSelectedProduct] = useState<ProductSpecItem>(BROCHURE_PRODUCTS[0]);
  const [activeCategory, setActiveCategory] = useState<string>('All Solutions');
  const [selectedDossierProduct, setSelectedDossierProduct] = useState<ProductSpecItem | null>(null);

  return (
    <PageContainer>
      <PageHeader
        title="Products"
        actions={
          <>
            <Button variant="primary" size="sm" onClick={() => setSelectedDossierProduct(selectedProduct)}>
              <FileText className="w-4 h-4 mr-1.5" />
              <span>View Dossier</span>
            </Button>
            <Link href="/dashboard">
              <Button variant="outline" size="sm">
                <span>Dashboard</span>
                <ChevronRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </Link>
          </>
        }
      />

      {/* ── 3D DEFENCE COMMAND CENTER & TELEMETRY STUDIO ── */}
      <div className="space-y-4 pt-1">
        {/* Top Status & Viewport Ticker */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white/90 backdrop-blur-md border border-[#DCD8CE] px-4 py-2.5 rounded-xl shadow-xs">
          <div className="flex items-center gap-2.5">
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <span className="text-xs font-serif font-bold text-[#14213D] uppercase tracking-wider">
              {BROCHURE_STATS.headquarters.split(',')[0]} · Central Command Studio
            </span>
            <span className="hidden md:inline-block text-[#C9C4B8]">|</span>
            <span className="hidden md:inline-block text-[11px] font-mono text-[#0F5E63] font-semibold bg-[#E3EFEE] px-2 py-0.5 rounded-md">
              MAKING INDIA SAFER
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono text-[#4A5568]">
            <div className="flex items-center gap-1.5">
              <span className="text-[#14213D] font-bold">20+</span>
              <span className="text-[11px]">Years</span>
            </div>
            <span>·</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[#14213D] font-bold">100+</span>
              <span className="text-[11px]">Projects</span>
            </div>
            <span>·</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[#14213D] font-bold">100+</span>
              <span className="text-[11px]">Clients</span>
            </div>
            <span>·</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[#14213D] font-bold">25+</span>
              <span className="text-[11px]">OEM Partners</span>
            </div>
          </div>
        </div>

        {/* ── 3-COLUMN TELEMETRY CENTERPIECE ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
          {/* Left Column: Unit Tracking Card */}
          <div className="lg:col-span-3 flex flex-col">
            <UnitTrackingCard
              product={selectedProduct}
              className="h-full"
              onCallOfficer={() => alert(`Initiating secure voice comms with Commander for ${selectedProduct.name}`)}
              onMessageOfficer={() => alert(`Dispatching encrypted tactical alert for ${selectedProduct.code}`)}
            />
          </div>

          {/* Center Column: 3D Hardware Viewport with Interactive Dossier Button */}
          <div className="lg:col-span-6 flex flex-col relative group">
            <Equipment3DViewer
              product={selectedProduct}
              className="h-full min-h-[420px]"
            />
            
            {/* Quick Action Overlay: Open Full Brochure Dossier */}
            <div className="absolute top-14 right-4 z-20">
              <button
                onClick={() => setSelectedDossierProduct(selectedProduct)}
                className="px-3 py-1.5 rounded-xl bg-white/90 hover:bg-white backdrop-blur-md border border-[#DCD8CE] shadow-sm text-xs font-medium text-[#0F5E63] hover:text-[#0B4A4E] transition-all flex items-center gap-1.5 hover:shadow-md"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Brochure Specs &amp; Dossier</span>
              </button>
            </div>
          </div>

          {/* Right Column: Tool-Matched Telemetry & Fleet Valuation */}
          <div className="lg:col-span-3 flex flex-col gap-3 justify-between">
            <HardwareTelemetryPanel
              product={selectedProduct}
              className="w-full"
            />

            <RevenueSplineChart
              totalValue={1920000}
              periodValue={1430000}
              periodLabel="1 Sep - 8 Sep"
              className="h-full"
            />
          </div>
        </div>

        {/* ── HORIZONTAL PRODUCT SELECTOR STRIP ── */}
        <div className="pt-1">
          <EquipmentSelectorStrip
            products={BROCHURE_PRODUCTS}
            selectedProduct={selectedProduct}
            onSelectProduct={(p) => {
              setSelectedProduct(p);
            }}
            activeCategory={activeCategory}
            onSelectCategory={(cat) => setActiveCategory(cat)}
          />
        </div>

        {/* ── BOTTOM GRID: DISTRIBUTION MAP & DEPLOYMENTS TABLE ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch pt-2">
          {/* Left Column: Tactical India Map */}
          <div className="lg:col-span-4 flex flex-col">
            <TacticalIndiaMap
              totalDeployments={BROCHURE_STATS.totalDeployments}
              onTimeRate={BROCHURE_STATS.onTimeReadiness}
              className="h-full"
            />
          </div>

          {/* Right Column: Active Deployments Table */}
          <div className="lg:col-span-8 flex flex-col">
            <DeploymentsTable className="h-full" />
          </div>
        </div>
      </div>

      {/* Full Brochure Specs Dossier Modal */}
      <ProductDossierModal
        product={selectedDossierProduct}
        onClose={() => setSelectedDossierProduct(null)}
      />
    </PageContainer>
  );
}
