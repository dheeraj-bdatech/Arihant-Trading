'use client';

import React, { useRef } from 'react';
import Image from 'next/image';
import { 
  ChevronLeft, 
  ChevronRight, 
  ShieldCheck, 
  SlidersHorizontal,
  Box
} from 'lucide-react';
import { ProductSpecItem, BROCHURE_CATEGORIES } from '@/lib/brochure-products';

interface EquipmentSelectorStripProps {
  products: ProductSpecItem[];
  selectedProduct: ProductSpecItem;
  onSelectProduct: (p: ProductSpecItem) => void;
  activeCategory: string;
  onSelectCategory: (cat: string) => void;
  className?: string;
}

export function EquipmentSelectorStrip({
  products,
  selectedProduct,
  onSelectProduct,
  activeCategory,
  onSelectCategory,
  className = ''
}: EquipmentSelectorStripProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = direction === 'left' ? -320 : 320;
      scrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const filteredProducts = activeCategory === 'All Solutions'
    ? products
    : products.filter(p => p.category === activeCategory);

  return (
    <div className={`space-y-2.5 ${className}`}>
      {/* Category Pills & Scroll Controls */}
      <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 no-scrollbar">
        <div className="flex items-center gap-1.5 shrink-0">
          {BROCHURE_CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => onSelectCategory(cat)}
              className={`px-3 py-1 text-xs rounded-full font-medium transition-all shrink-0 ${
                activeCategory === cat
                  ? 'bg-[#0F5E63] text-white shadow-sm'
                  : 'bg-white text-[#4A5568] border border-[#DCD8CE] hover:text-[#14213D] hover:bg-[#FBFAF7]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="hidden sm:flex items-center gap-1 shrink-0 ml-auto">
          <button
            onClick={() => scroll('left')}
            className="p-1 rounded-lg bg-white border border-[#DCD8CE] text-[#4A5568] hover:text-[#14213D] hover:bg-[#FBFAF7] transition-colors"
            title="Scroll Left"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => scroll('right')}
            className="p-1 rounded-lg bg-white border border-[#DCD8CE] text-[#4A5568] hover:text-[#14213D] hover:bg-[#FBFAF7] transition-colors"
            title="Scroll Right"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Horizontal Hardware Strip (Matching user reference image) */}
      <div
        ref={scrollRef}
        className="flex items-stretch gap-3 overflow-x-auto pb-2 pt-1 scroll-smooth no-scrollbar"
      >
        {filteredProducts.map((p) => {
          const isSelected = selectedProduct.id === p.id;

          return (
            <button
              key={p.id}
              onClick={() => onSelectProduct(p)}
              className={`relative flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-[12px] border transition-all text-left shrink-0 min-w-[220px] max-w-[270px] ${
                isSelected
                  ? 'bg-white border-[#0F5E63] shadow-md ring-2 ring-[#0F5E63]/20 translate-y-[-2px]'
                  : 'bg-white/80 hover:bg-white border-[#DCD8CE] hover:border-[#C9C4B8] shadow-sm'
              }`}
            >
              {/* Product Info */}
              <div className="flex flex-col min-w-0 pr-2">
                <div className="flex items-center gap-1.5">
                  <span className={`font-mono text-xs font-bold ${isSelected ? 'text-[#0F5E63]' : 'text-[#14213D]'}`}>
                    {p.code}
                  </span>
                  {p.isMhaQr && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#9A3412]" title="MHA QR" />
                  )}
                </div>
                <div className="text-[11px] font-semibold text-[#14213D] truncate mt-0.5" title={p.name}>
                  {p.name}
                </div>
                <div className="text-[10px] text-[#4A5568] truncate mt-0.5">
                  {p.weight || p.batteryLife || p.specRef}
                </div>
              </div>

              {/* 3D Render Thumbnail */}
              <div className="w-16 h-12 relative shrink-0 flex items-center justify-center p-1 rounded-lg bg-[#FAF9F6] border border-[#ECE9E2]">
                <img
                  src={p.image}
                  alt={p.name}
                  className="max-h-full max-w-full object-contain filter drop-shadow-sm transition-transform group-hover:scale-105"
                  loading="lazy"
                />
              </div>

              {/* Selected Highlight Bar */}
              {isSelected && (
                <div className="absolute -top-[1px] left-4 right-4 h-[2px] bg-[#0F5E63] rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
