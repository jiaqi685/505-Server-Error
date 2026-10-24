import {
  Coffee,
  Cookie,
  Droplets,
  Fish,
  GlassWater,
  Milk,
  Package,
  ScrollText,
  Soup,
  Sparkles,
  Wheat,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  "premium-fragrant-rice": Wheat,
  "edible-cooking-oil": Droplets,
  "granulated-white-sugar": Package,
  "plain-wheat-flour": Wheat,
  "instant-noodles-5-pack": Soup,
  "sardine-tomato-sauce": Fish,
  "sweetened-creamer": Milk,
  "soya-sauce-650ml": Droplets,
  "drinking-water": GlassWater,
  "carbonated-drink": GlassWater,
  "original-uht-milk": Milk,
  "coffee-instant-mix": Coffee,
  "cream-cracker-biscuits": Cookie,
  "potato-crisps": Package,
  "strawberry-uht-milk": Milk,
  "chocolate-uht-milk": Milk,
  "laundry-detergent": Sparkles,
  "cleaner-liquid": Sparkles,
  "bathroom-tissue": ScrollText,
  "bath-soap": Sparkles,
  toothpaste: Sparkles,
  "hair-shampoo": Droplets,
};

export function ProductIcon({ productId, size = 40 }: { productId: string; size?: number }) {
  const Icon = ICONS[productId] ?? Package;
  return (
    <div className="item-icon" style={{ width: size, height: size }} aria-hidden="true">
      <Icon size={Math.round(size * 0.48)} strokeWidth={1.8} />
    </div>
  );
}
