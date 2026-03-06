"use client";

import { useState, useEffect, useCallback } from "react";
import type { User } from "@supabase/supabase-js";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Home,
  Camera,
  ClipboardCheck,
  Plus,
  MapPin,
  Zap,
  ArrowRight,
} from "lucide-react";
import { AddPropertyDialog } from "./add-property-dialog";
import Link from "next/link";

interface Property {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  propertyType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  squareFeet: number | null;
  notes: string | null;
  coverImageUrl: string | null;
  trainingStatus: string | null;
  createdAt: string;
}

export function DashboardContent({ user }: { user: User }) {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  const fetchProperties = useCallback(async () => {
    try {
      const res = await fetch("/api/properties", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setProperties(data);
      }
    } catch (err) {
      console.error("Failed to fetch properties:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProperties();
  }, [fetchProperties]);

  function handlePropertyAdded() {
    fetchProperties();
  }

  const trainedCount = properties.filter((p) => p.trainingStatus === "trained").length;

  return (
    <AppLayout userEmail={user.email || ""}>
      <div className="p-6 lg:p-8 max-w-7xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Properties</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage your luxury property inspections
            </p>
          </div>
          <Button onClick={() => setDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Add Property
          </Button>
        </div>

        {/* Quick Stats */}
        <div className="grid gap-4 sm:grid-cols-3 mb-8">
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Properties
              </CardTitle>
              <Home className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{properties.length}</div>
              <p className="text-xs text-muted-foreground">Total managed</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Trained
              </CardTitle>
              <Zap className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{trainedCount}</div>
              <p className="text-xs text-muted-foreground">AI-ready properties</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Inspections
              </CardTitle>
              <ClipboardCheck className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">--</div>
              <p className="text-xs text-muted-foreground">Average readiness</p>
            </CardContent>
          </Card>
        </div>

        {/* Property List */}
        {loading ? (
          <Card className="bg-card border-border">
            <CardContent className="flex items-center justify-center py-16">
              <p className="text-muted-foreground">Loading properties...</p>
            </CardContent>
          </Card>
        ) : properties.length === 0 ? (
          <Card className="bg-card border-border">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <Upload className="h-8 w-8 text-primary" />
              </div>
              <CardTitle className="mb-2 text-foreground">Welcome to The Eye</CardTitle>
              <CardDescription className="mb-6 text-center max-w-md text-muted-foreground">
                Start by adding a property, then upload photos or video to train the AI.
                Your first property will be ready for inspections in minutes.
              </CardDescription>
              <Button onClick={() => setDialogOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                Add Your First Property
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {properties.map((property) => (
              <Link key={property.id} href={`/property/${property.id}`}>
                <Card className="bg-card border-border cursor-pointer hover:border-primary/50 transition-all group">
                  {/* Cover image or placeholder */}
                  <div className="h-32 bg-secondary rounded-t-lg flex items-center justify-center overflow-hidden">
                    {property.coverImageUrl ? (
                      <img
                        src={property.coverImageUrl}
                        alt={property.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Home className="h-8 w-8 text-muted-foreground" />
                    )}
                  </div>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base text-foreground group-hover:text-primary transition-colors">
                        {property.name}
                      </CardTitle>
                      <TrainingBadge status={property.trainingStatus} />
                    </div>
                    {(property.address || property.city) && (
                      <CardDescription className="flex items-center gap-1 text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {[property.address, property.city, property.state]
                          .filter(Boolean)
                          .join(", ")}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <div className="flex gap-3 text-xs text-muted-foreground">
                        {property.propertyType && (
                          <span className="capitalize">{property.propertyType}</span>
                        )}
                        {property.bedrooms != null && (
                          <span>{property.bedrooms} bed</span>
                        )}
                        {property.bathrooms != null && (
                          <span>{property.bathrooms} bath</span>
                        )}
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      <AddPropertyDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={handlePropertyAdded}
      />
    </AppLayout>
  );
}

function TrainingBadge({ status }: { status: string | null }) {
  if (status === "trained") {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
        Trained
      </span>
    );
  }
  if (status === "training") {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
        Training...
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
      Untrained
    </span>
  );
}

function Upload(props: React.SVGProps<SVGSVGElement> & { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" x2="12" y1="3" y2="15" />
    </svg>
  );
}
