'use client';

import React, { useState } from 'react';
import { 
  Calendar, 
  Filter, 
  Search, 
  ArrowUpRight, 
  ShieldCheck, 
  Clock,
  CheckCircle2,
  Truck,
  ExternalLink
} from 'lucide-react';
import { Badge } from '@/components/ui';

interface DeploymentRow {
  id: string;
  orderId: string;
  hardwareModel: string;
  assignedTo: string;
  pickupAddress: string;
  deliveryAddress: string;
  estDelivery: string;
  status: 'Delivered' | 'Picked Up' | 'In Transit' | 'Field Ready' | 'Under Inspection';
}

export function DeploymentsTable({ className = '' }: { className?: string }) {
  const [activeTab, setActiveTab] = useState<'pending' | 'responded' | 'assigned' | 'completed'>('assigned');
  const [searchQuery, setSearchQuery] = useState('');

  const sampleRows: DeploymentRow[] = [
    {
      id: '1',
      orderId: '#ATC-BB84610',
      hardwareModel: 'Unmanned Ground Vehicle (UGV / EOD)',
      assignedTo: 'Col. Rajesh Verma',
      pickupAddress: 'Patna HQ Central Depot',
      deliveryAddress: 'Pathankot Airbase · Sector 4',
      estDelivery: '12 Sep, 2026',
      status: 'Delivered'
    },
    {
      id: '2',
      orderId: '#ATC-FBS-99201',
      hardwareModel: 'X-Ray Full Body Scanner System',
      assignedTo: 'Capt. Pradeep Roy',
      pickupAddress: 'Delhi NCR Logistics Hub',
      deliveryAddress: 'Kolkata Eastern HQ Depot',
      estDelivery: '15 Sep, 2026',
      status: 'Picked Up'
    },
    {
      id: '3',
      orderId: '#ATC-NIJ4-0419',
      hardwareModel: 'NIJ Level 4 Tactical Shield Rig',
      assignedTo: 'Maj. Vikramjit Singh',
      pickupAddress: 'Pathankot Forward Base',
      deliveryAddress: 'Jammu High Security Zone',
      estDelivery: '18 Sep, 2026',
      status: 'In Transit'
    },
    {
      id: '4',
      orderId: '#ATC-RAM-55102',
      hardwareModel: 'Serstech Raman Narcotics Detector',
      assignedTo: 'Officer Priya Nair',
      pickupAddress: 'Mumbai Port Authority Depot',
      deliveryAddress: 'Customs Interception Wing 2',
      estDelivery: '24 Sep, 2026',
      status: 'In Transit'
    },
    {
      id: '5',
      orderId: '#ATC-DSM-88120',
      hardwareModel: 'Deep Search Mine Detector (DSMD)',
      assignedTo: 'Cmdr. Kishore Das',
      pickupAddress: 'Guwahati Assam Warehouse',
      deliveryAddress: 'Border Post Delta 9',
      estDelivery: '28 Sep, 2026',
      status: 'Field Ready'
    }
  ];

  const getStatusBadge = (status: DeploymentRow['status']) => {
    switch (status) {
      case 'Delivered':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
            Active in Field
          </span>
        );
      case 'Picked Up':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
            Under Calibration
          </span>
        );
      case 'In Transit':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
            Base Transfer
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#E3EFEE] text-[#0F5E63]">
            {status}
          </span>
        );
    }
  };

  const filteredRows = sampleRows.filter(r => 
    r.orderId.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.hardwareModel.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.assignedTo.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.deliveryAddress.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className={`rounded-[14px] bg-white border border-[#DCD8CE] shadow-sm p-4 ${className}`}>
      {/* Header with Title and Segmented Tabs (Matching reference image) */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[#ECE9E2]">
        <div className="flex items-center gap-2">
          <h3 className="font-serif font-bold text-base text-[#14213D]">
            Active Deployments & Missions
          </h3>
          <span className="px-2 py-0.5 rounded-full bg-[#FBFAF7] border border-[#DCD8CE] text-xs font-mono font-semibold text-[#4A5568]">
            264
          </span>
        </div>

        {/* Status Filter Tabs (Matching Pending 70 | Responded 85 | Assigned 53 | Completed 56) */}
        <div className="flex items-center gap-1 bg-[#FBFAF7] border border-[#ECE9E2] p-1 rounded-xl text-xs font-medium overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveTab('pending')}
            className={`px-3 py-1 rounded-lg transition-all shrink-0 ${
              activeTab === 'pending'
                ? 'bg-white text-[#14213D] shadow-sm font-semibold'
                : 'text-[#4A5568] hover:text-[#14213D]'
            }`}
          >
            Pending <span className="font-mono text-[11px] opacity-75">70</span>
          </button>
          <button
            onClick={() => setActiveTab('responded')}
            className={`px-3 py-1 rounded-lg transition-all shrink-0 ${
              activeTab === 'responded'
                ? 'bg-white text-[#14213D] shadow-sm font-semibold'
                : 'text-[#4A5568] hover:text-[#14213D]'
            }`}
          >
            Responded <span className="font-mono text-[11px] opacity-75">85</span>
          </button>
          <button
            onClick={() => setActiveTab('assigned')}
            className={`px-3 py-1 rounded-lg transition-all shrink-0 ${
              activeTab === 'assigned'
                ? 'bg-white text-[#0F5E63] shadow-sm font-bold border border-[#0F5E63]/20'
                : 'text-[#4A5568] hover:text-[#14213D]'
            }`}
          >
            Assigned <span className="font-mono text-[11px] opacity-75">53</span>
          </button>
          <button
            onClick={() => setActiveTab('completed')}
            className={`px-3 py-1 rounded-lg transition-all shrink-0 ${
              activeTab === 'completed'
                ? 'bg-white text-[#14213D] shadow-sm font-semibold'
                : 'text-[#4A5568] hover:text-[#14213D]'
            }`}
          >
            Completed <span className="font-mono text-[11px] opacity-75">56</span>
          </button>
        </div>

        {/* Quick Toolbar */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#4A5568]" />
            <input
              type="text"
              placeholder="Search mission ID, officer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-2.5 py-1 text-xs bg-[#FBFAF7] border border-[#C9C4B8] rounded-lg text-[#14213D] focus:outline-none focus:ring-1 focus:ring-[#0F5E63] w-36 sm:w-44"
            />
          </div>
          <button 
            aria-label="Filter deployments calendar"
            className="p-1.5 rounded-lg border border-[#DCD8CE] text-[#4A5568] hover:text-[#14213D] hover:bg-[#FBFAF7]"
          >
            <Calendar className="w-3.5 h-3.5" />
          </button>
          <button 
            aria-label="Filter deployments table"
            className="p-1.5 rounded-lg border border-[#DCD8CE] text-[#4A5568] hover:text-[#14213D] hover:bg-[#FBFAF7]"
          >
            <Filter className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Table Content (Matching columns in user reference image) */}
      <div className="overflow-x-auto mt-2">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-[#ECE9E2] text-[#4A5568] font-medium bg-[#FBFAF7]/60">
              <th className="py-2.5 px-3 font-mono">Equipment ID</th>
              <th className="py-2.5 px-3">Custodial Specialist</th>
              <th className="py-2.5 px-3">Ordnance Depot / Bay</th>
              <th className="py-2.5 px-3">Deployment Site</th>
              <th className="py-2.5 px-3 font-mono">Next Inspection</th>
              <th className="py-2.5 px-3 text-right">Operational Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#ECE9E2]">
            {filteredRows.map((row) => (
              <tr 
                key={row.id} 
                className="hover:bg-[#F6F5F1]/60 transition-colors group cursor-pointer"
              >
                <td className="py-3 px-3 font-mono font-bold text-[#14213D]">
                  {row.orderId}
                  <div className="text-[10px] font-sans font-normal text-[#4A5568] truncate max-w-[130px]">
                    {row.hardwareModel}
                  </div>
                </td>
                <td className="py-3 px-3">
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-3 bg-emerald-700 rounded-sm text-[8px] text-white flex items-center justify-center font-bold">
                      IN
                    </span>
                    <span className="font-medium text-[#14213D]">{row.assignedTo}</span>
                  </div>
                </td>
                <td className="py-3 px-3 text-[#4A5568]">
                  {row.pickupAddress}
                </td>
                <td className="py-3 px-3 text-[#14213D] font-medium">
                  {row.deliveryAddress}
                </td>
                <td className="py-3 px-3 font-mono text-[#4A5568]">
                  {row.estDelivery}
                </td>
                <td className="py-3 px-3 text-right">
                  {getStatusBadge(row.status)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
