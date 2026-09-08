import { useState } from 'react';
import { listingFromUrl } from '@/services/listing';
import { Button, Callout, Chip, Field, Input, Segmented } from '@/components/ui';
import { Icon } from '@/components/icons';
import type { DraftListing } from './types';

const SOURCE_LABEL: Record<string, string> = { zillow: 'Zillow', redfin: 'Redfin', realtor: 'Realtor.com', rightmove: 'Rightmove', other: 'Marketplace' };

/**
 * Step 1 — the unit: where it is, what it rents for, when it is available. The step's id stays
 * `listing` (the wizard and saved drafts key off it); everything a person reads says "unit", and
 * "listing" is kept only for the marketplace page the URL points at (docs/COPY.md).
 */
export function StepListing({ listing, onChange }: { listing: DraftListing; onChange: (patch: Partial<DraftListing>) => void }) {
  const [url, setUrl] = useState(listing.url);
  const [readAt, setReadAt] = useState<number | null>(listing.inferred ? 1 : null);

  const read = () => {
    const u = url.trim();
    if (!u) return;
    const meta = listingFromUrl(u);
    const found = meta.address !== 'New unit';
    onChange({
      mode: 'url',
      url: u,
      source: meta.source,
      address: found ? meta.address : listing.address,
      price: meta.price ?? '',
      availableFrom: listing.availableFrom,
      beds: meta.beds != null ? String(meta.beds) : '',
      baths: meta.baths != null ? String(meta.baths) : '',
      sqft: meta.sqft != null ? String(meta.sqft) : '',
      summary: '',
      inferred: found,
    });
    setReadAt(Date.now());
  };

  return (
    <div className="panel flex flex-col gap-6 p-5 shadow-sm md:p-6">
      <Segmented
        value={listing.mode}
        onChange={(mode) => onChange({ mode, inferred: mode === 'url' ? listing.inferred : false })}
        className="w-full sm:w-auto"
        options={[
          {
            value: 'url',
            label: (
              <>
                <span className="sm:hidden">Listing URL</span>
                <span className="hidden sm:inline">Paste the listing page URL</span>
              </>
            ),
            icon: <Icon.Link size={15} />,
          },
          {
            value: 'photos',
            label: (
              <>
                <span className="sm:hidden">Photos only</span>
                <span className="hidden sm:inline">Start from photos only</span>
              </>
            ),
            icon: <Icon.Camera size={15} />,
          },
        ]}
      />

      {listing.mode === 'url' ? (
        <div className="flex flex-col gap-3">
          <Field label="Listing page URL" hint="Zillow, Apartments.com, Redfin, Rightmove or anything else the unit is syndicated to.">
            <div className="flex gap-2">
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && read()}
                placeholder="https://www.zillow.com/homedetails/1247-Oak-St-San-Francisco-CA-94117/…"
                inputMode="url"
                autoFocus
              />
              <Button variant="primary" onClick={read} disabled={!url.trim()}>
                Read
              </Button>
            </div>
          </Field>
          {readAt ? (
            <Callout tone={listing.inferred ? 'info' : 'warn'} title={listing.inferred ? 'Read from the URL — confirm below' : 'Could not read an address from that URL'}>
              {listing.inferred
                ? 'Marketplaces block scraping from a browser, so Audora reads what the URL itself says (the address) and fills the rest with placeholders. Every field is editable. Confirm them before you generate.'
                : 'Type the address in below. The photos and the floor plan carry the model; these details only appear in the unit header.'}
              {listing.source ? (
                <div className="mt-2">
                  <Chip>{SOURCE_LABEL[listing.source] ?? listing.source}</Chip>
                </div>
              ) : null}
            </Callout>
          ) : null}
        </div>
      ) : (
        <Callout tone="info">No URL needed. Type the address and carry on to the room photos.</Callout>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Address" className="md:col-span-2">
          <Input value={listing.address} onChange={(e) => onChange({ address: e.target.value, inferred: false })} placeholder="1247 Oak St, San Francisco, CA 94117" />
        </Field>
        <Field label="Title" hint="Optional. Defaults to the address." className="md:col-span-2">
          <Input value={listing.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="1247 Oak Street" />
        </Field>
        {/* Rent and the available date are the two facts a renter decides against, so they share a row. */}
        <Field label="Rent per month">
          <Input value={listing.price} onChange={(e) => onChange({ price: e.target.value })} placeholder="$4,250/mo" className="mono" />
        </Field>
        <Field label="Available from" hint="Optional. The date the unit is ready for a new renter.">
          <Input type="date" value={listing.availableFrom} onChange={(e) => onChange({ availableFrom: e.target.value })} className="mono" />
        </Field>
        <div className="grid grid-cols-3 gap-3 md:col-span-2">
          <Field label="Beds">
            <Input value={listing.beds} onChange={(e) => onChange({ beds: e.target.value })} inputMode="numeric" placeholder="2" className="mono" />
          </Field>
          <Field label="Baths">
            <Input value={listing.baths} onChange={(e) => onChange({ baths: e.target.value })} inputMode="decimal" placeholder="1" className="mono" />
          </Field>
          <Field label="Sq ft">
            <Input value={listing.sqft} onChange={(e) => onChange({ sqft: e.target.value })} inputMode="numeric" placeholder="1180" className="mono" />
          </Field>
        </div>
        <Field label="Summary" hint="A sentence for the unit header. Optional." className="md:col-span-2">
          <textarea
            value={listing.summary}
            onChange={(e) => onChange({ summary: e.target.value })}
            rows={2}
            placeholder="Top-floor flat, vacant and freshly painted."
            className="w-full resize-y rounded-[10px] border border-line-2 bg-bg px-3 py-2 text-sm text-ink placeholder:text-faint outline-none transition-colors focus:border-ink focus:ring-[3px] focus:ring-accent-soft"
          />
        </Field>
      </div>
    </div>
  );
}
