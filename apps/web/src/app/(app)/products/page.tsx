'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { FileText, Search, ChevronRight, Layers, ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react';
import {
  PageContainer,
  PageHeader,
  Button,
  Badge,
  Card,
  FilterMenu,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui';
import {
  BROCHURE_PRODUCTS,
  BROCHURE_STATS,
  type ProductSpecItem
} from '@/lib/brochure-products';
import { Equipment3DViewer } from '@/components/dashboard/Equipment3DViewer';
import { HardwareTelemetryPanel } from '@/components/dashboard/HardwareTelemetryPanel';
import { RevenueSplineChart } from '@/components/dashboard/RevenueSplineChart';
import { UnitTrackingCard } from '@/components/dashboard/UnitTrackingCard';
import { EquipmentSelectorStrip } from '@/components/dashboard/EquipmentSelectorStrip';
import { TacticalIndiaMap } from '@/components/dashboard/TacticalIndiaMap';
import { ProductDossierModal } from '@/components/dashboard/ProductDossierModal';

// Deployment register rows (same sample set the old DeploymentsTable widget showed).
type DeploymentStatus = 'Delivered' | 'Picked Up' | 'In Transit' | 'Field Ready' | 'Under Inspection';

interface DeploymentRow {
  id: string;
  orderId: string;
  hardwareModel: string;
  assignedTo: string;
  pickupAddress: string;
  deliveryAddress: string;
  estDelivery: string;
  /** ISO date used for sorting the display string above */
  estDeliveryIso: string;
  status: DeploymentStatus;
}

const DEPLOYMENT_ROWS: DeploymentRow[] = [
  { id: '1', orderId: '#ATC-BB84610', hardwareModel: 'Unmanned Ground Vehicle (UGV / EOD)', assignedTo: 'Col. Rajesh Verma', pickupAddress: 'Patna HQ Central Depot', deliveryAddress: 'Pathankot Airbase · Sector 4', estDelivery: '12 Sep, 2026', estDeliveryIso: '2026-09-12', status: 'Delivered' },
  { id: '2', orderId: '#ATC-FBS-99201', hardwareModel: 'X-Ray Full Body Scanner System', assignedTo: 'Capt. Pradeep Roy', pickupAddress: 'Delhi NCR Logistics Hub', deliveryAddress: 'Kolkata Eastern HQ Depot', estDelivery: '15 Sep, 2026', estDeliveryIso: '2026-09-15', status: 'Picked Up' },
  { id: '3', orderId: '#ATC-NIJ4-0419', hardwareModel: 'NIJ Level 4 Tactical Shield Rig', assignedTo: 'Maj. Vikramjit Singh', pickupAddress: 'Pathankot Forward Base', deliveryAddress: 'Jammu High Security Zone', estDelivery: '18 Sep, 2026', estDeliveryIso: '2026-09-18', status: 'In Transit' },
  { id: '4', orderId: '#ATC-RAM-55102', hardwareModel: 'Serstech Raman Narcotics Detector', assignedTo: 'Officer Priya Nair', pickupAddress: 'Mumbai Port Authority Depot', deliveryAddress: 'Customs Interception Wing 2', estDelivery: '24 Sep, 2026', estDeliveryIso: '2026-09-24', status: 'In Transit' },
  { id: '5', orderId: '#ATC-DSM-88120', hardwareModel: 'Deep Search Mine Detector (DSMD)', assignedTo: 'Cmdr. Kishore Das', pickupAddress: 'Guwahati Assam Warehouse', deliveryAddress: 'Border Post Delta 9', estDelivery: '28 Sep, 2026', estDeliveryIso: '2026-09-28', status: 'Field Ready' },
];

const STATUS_META: Record<DeploymentStatus, { label: string; badge: 'success' | 'cyber' | 'warning' | 'info' }> = {
  Delivered: { label: 'Active in Field', badge: 'success' },
  'Picked Up': { label: 'Under Calibration', badge: 'cyber' },
  'In Transit': { label: 'Base Transfer', badge: 'warning' },
  'Field Ready': { label: 'Field Ready', badge: 'info' },
  'Under Inspection': { label: 'Under Inspection', badge: 'info' },
};

const SORT_FIELDS = [
  { key: 'inspection', label: 'Next inspection' },
  { key: 'equipment', label: 'Equipment ID' },
  { key: 'specialist', label: 'Custodial specialist' },
] as const;
type SortField = (typeof SORT_FIELDS)[number]['key'];

export default function ProductsPage() {
  const [selectedProduct, setSelectedProduct] = useState<ProductSpecItem>(BROCHURE_PRODUCTS[0]);
  const [activeCategory, setActiveCategory] = useState<string>('All Solutions');
  const [selectedDossierProduct, setSelectedDossierProduct] = useState<ProductSpecItem | null>(null);

  // Deployment register filters
  const [deploySearch, setDeploySearch] = useState('');
  const [deployStatus, setDeployStatus] = useState<DeploymentStatus | 'all'>('all');
  const [deploySort, setDeploySort] = useState<SortField>('inspection');
  const [deploySortOrder, setDeploySortOrder] = useState<'asc' | 'desc'>('asc');

  const statusCounts = useMemo(() => {
    const c = {} as Record<DeploymentStatus, number>;
    for (const r of DEPLOYMENT_ROWS) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, []);

  const deploymentRows = useMemo(() => {
    const q = deploySearch.trim().toLowerCase();
    const rows = DEPLOYMENT_ROWS.filter((r) => {
      if (deployStatus !== 'all' && r.status !== deployStatus) return false;
      if (!q) return true;
      return [r.orderId, r.hardwareModel, r.assignedTo, r.pickupAddress, r.deliveryAddress].some((v) => v.toLowerCase().includes(q));
    });
    const key = (r: DeploymentRow) =>
      deploySort === 'equipment' ? r.orderId : deploySort === 'specialist' ? r.assignedTo : r.estDeliveryIso;
    rows.sort((a, b) => key(a).localeCompare(key(b)) * (deploySortOrder === 'asc' ? 1 : -1));
    return rows;
  }, [deploySearch, deployStatus, deploySort, deploySortOrder]);

  const hasDeployFilters = Boolean(deploySearch.trim() || deployStatus !== 'all');
  const clearDeployFilters = () => {
    setDeploySearch('');
    setDeployStatus('all');
  };

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

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono text-[#4A5568]">
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
            <div className="absolute top-[6.25rem] right-3 sm:top-14 sm:right-4 z-20">
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

        {/* ── BOTTOM GRID: DISTRIBUTION MAP & DEPLOYMENTS REGISTER ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch pt-2">
          {/* Left Column: Tactical India Map (its built-in region <select> is display-only, hidden here) */}
          <div className="lg:col-span-4 flex flex-col">
            <TacticalIndiaMap
              totalDeployments={BROCHURE_STATS.totalDeployments}
              onTimeRate={BROCHURE_STATS.onTimeReadiness}
              className="h-full"
            />
          </div>

          {/* Right Column: Active Deployments register — one filter row + a table that fits the column */}
          <div className="lg:col-span-8 flex min-w-0 flex-col gap-3">
            <Card padding="sm" className="relative z-20 overflow-visible border-[#DCD8CE]">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                <div className="relative w-full min-w-[200px] lg:w-auto lg:flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A8578]" aria-hidden />
                  <input
                    type="search"
                    aria-label="Search deployments"
                    placeholder="Search mission ID, equipment, officer, site…"
                    value={deploySearch}
                    onChange={(e) => setDeploySearch(e.target.value)}
                    className="h-9 w-full rounded-lg border border-[#C9C4B8] bg-white pl-9 pr-3 text-xs text-[#14213D] placeholder:text-[#8A8578] focus:border-[#0F5E63] focus:outline-none focus:ring-2 focus:ring-[#0F5E63]/15"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
                  <FilterMenu
                    label="Status"
                    icon={<Layers />}
                    options={[
                      { key: 'all', label: 'All statuses', count: DEPLOYMENT_ROWS.length },
                      ...(Object.keys(STATUS_META) as DeploymentStatus[])
                        .filter((st) => statusCounts[st])
                        .map((st) => ({ key: st, label: STATUS_META[st].label, count: statusCounts[st] })),
                    ].map((o) => ({
                      ...o,
                      active: deployStatus === o.key,
                      onSelect: () => setDeployStatus(o.key as DeploymentStatus | 'all'),
                    }))}
                  />
                  <FilterMenu
                    label="Sort"
                    icon={<ArrowUpDown />}
                    neutralKeys={[...SORT_FIELDS.map((f) => f.key), 'dir_desc', 'dir_asc']}
                    align="right"
                    options={[
                      ...SORT_FIELDS.map((f) => ({
                        key: f.key,
                        label: f.label,
                        active: deploySort === f.key,
                        onSelect: () => setDeploySort(f.key),
                      })),
                      { key: 'dir_desc', label: 'Descending', icon: <ChevronDown />, active: deploySortOrder === 'desc', onSelect: () => setDeploySortOrder('desc') },
                      { key: 'dir_asc', label: 'Ascending', icon: <ChevronUp />, active: deploySortOrder === 'asc', onSelect: () => setDeploySortOrder('asc') },
                    ]}
                  />
                  {hasDeployFilters && (
                    <Button variant="ghost" size="xs" onClick={clearDeployFilters} className="text-xs text-[#4A5568] hover:text-[#881337]">
                      Clear
                    </Button>
                  )}
                </div>
              </div>
            </Card>

            <Card padding="none" className="flex-1 overflow-hidden border-[#DCD8CE] [&_.ui-table-wrap]:rounded-none [&_.ui-table-wrap]:border-0 [&_.ui-table-wrap]:shadow-none">
              <div className="flex items-center gap-2 border-b border-[#ECE9E2] px-4 py-3">
                <h3 className="font-serif text-base font-bold text-[#14213D]">Active Deployments &amp; Missions</h3>
                <span className="rounded-full border border-[#DCD8CE] bg-[#FBFAF7] px-2 py-0.5 font-mono text-xs font-semibold text-[#4A5568]">
                  {deploymentRows.length}
                </span>
              </div>
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[34%] px-3">Equipment</TableHead>
                    <TableHead className="w-[22%] px-3">Specialist</TableHead>
                    <TableHead className="w-[26%] px-3">Route</TableHead>
                    <TableHead className="w-[18%] px-3 text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deploymentRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-[#4A5568]">
                        No deployments match these filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    deploymentRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="px-3 py-3">
                          <div className="truncate font-mono font-bold text-[#14213D]" title={row.orderId}>{row.orderId}</div>
                          <div className="truncate text-[11px] text-[#4A5568]" title={row.hardwareModel}>{row.hardwareModel}</div>
                        </TableCell>
                        <TableCell className="px-3 py-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="flex h-3 w-4 shrink-0 items-center justify-center rounded-sm bg-emerald-700 text-[8px] font-bold text-white">IN</span>
                            <span className="truncate font-medium text-[#14213D]" title={row.assignedTo}>{row.assignedTo}</span>
                          </div>
                        </TableCell>
                        <TableCell className="px-3 py-3">
                          <div className="truncate font-medium text-[#14213D]" title={`Deployment site: ${row.deliveryAddress}`}>{row.deliveryAddress}</div>
                          <div className="truncate text-[11px] text-[#4A5568]" title={`Ordnance depot / bay: ${row.pickupAddress}`}>from {row.pickupAddress}</div>
                        </TableCell>
                        <TableCell className="px-3 py-3 text-right">
                          <Badge variant={STATUS_META[row.status].badge} size="sm">{STATUS_META[row.status].label}</Badge>
                          <div className="mt-1 font-mono text-[11px] text-[#4A5568]" title="Next inspection">{row.estDelivery}</div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Card>
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
