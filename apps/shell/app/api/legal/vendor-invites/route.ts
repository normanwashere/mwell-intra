import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@shell/lib/supabase/server';
import { SUPABASE_URL } from '@shell/lib/supabase/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface VendorInviteBody {
  email?: string;
  company_name?: string;
  category?: string;
  actor_email?: string;
  profile?: Record<string, unknown>;
  origin_country?: string;
}

interface InviteRpcResult {
  invite: { id: string; vendor_id: string; case_id: string };
  vendor: { id: string };
  case: { id: string };
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function invitationRedirect(request: NextRequest): string {
  const configured = process.env.APP_URL?.trim();
  if (process.env.NODE_ENV === 'production' && !configured) {
    throw new Error('APP_URL is required for production vendor invitation links.');
  }
  const base = new URL(configured || request.nextUrl.origin);
  if (base.protocol !== 'https:' && base.hostname !== 'localhost' && base.hostname !== '127.0.0.1') {
    throw new Error('Vendor invitation links require HTTPS.');
  }
  const target = new URL('/reset-password', base);
  target.searchParams.set('next', '/vendor');
  return target.toString();
}

async function findAuthUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<User | null> {
  const perPage = 1000;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < perPage) return null;
  }
  throw new Error('Auth user lookup exceeded the supported directory size.');
}

async function markDelivery(
  admin: SupabaseClient,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await admin
    .schema('legal')
    .rpc('finalize_vendor_invite_delivery', { payload });
  if (error) throw new Error(error.message);
}

export async function POST(request: NextRequest) {
  const secretKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!SUPABASE_URL || !secretKey) {
    return jsonError('Vendor email delivery is not configured.', 503);
  }

  const userClient = await createSupabaseServerClient('legal');
  if (!userClient) return jsonError('Supabase is not configured.', 503);
  const { data: verified, error: authError } = await userClient.auth.getUser();
  if (authError || !verified.user) return jsonError('Authentication required.', 401);

  let body: VendorInviteBody;
  try {
    body = (await request.json()) as VendorInviteBody;
  } catch {
    return jsonError('Invalid JSON request.', 400);
  }
  const email = body.email?.trim().toLowerCase();
  const companyName = body.company_name?.trim();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return jsonError('A valid vendor email is required.', 400);
  }
  if (!companyName) return jsonError('Company name is required.', 400);

  const admin = createClient(SUPABASE_URL, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: existingProfile, error: profileError } = await admin
    .schema('core')
    .from('profiles')
    .select('id, kind')
    .eq('email', email)
    .maybeSingle();
  if (profileError) return jsonError(profileError.message, 502);
  if (existingProfile?.kind === 'employee') {
    return jsonError('This email belongs to an employee account and cannot be invited as a vendor.', 409);
  }

  const { data: inviteData, error: inviteRpcError } = await userClient.rpc(
    'invite_vendor',
    {
      payload: {
        email,
        company_name: companyName,
        category: body.category,
        actor: verified.user.email,
        profile: body.profile,
        origin_country: body.origin_country,
      },
    },
  );
  if (inviteRpcError) return jsonError(inviteRpcError.message, 403);
  const invite = inviteData as unknown as InviteRpcResult;

  try {
    const redirectTo = invitationRedirect(request);
    let authUser = await findAuthUserByEmail(admin, email);
    if (authUser) {
      const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: { company_name: companyName },
      });
      if (error) throw new Error(error.message);
      authUser = data.user;
    }
    if (!authUser) throw new Error('Supabase Auth did not return the invited user.');

    const currentRoles =
      authUser.app_metadata?.roles && typeof authUser.app_metadata.roles === 'object'
        ? (authUser.app_metadata.roles as Record<string, string[]>)
        : {};
    const coreRoles = new Set([...(currentRoles.core ?? []), 'vendor_portal']);
    const { error: metadataError } = await admin.auth.admin.updateUserById(authUser.id, {
      app_metadata: { ...authUser.app_metadata, roles: { ...currentRoles, core: [...coreRoles] } },
    });
    if (metadataError) throw new Error(metadataError.message);

    await markDelivery(admin, {
      invite_id: invite.invite.id,
      status: 'sent',
      auth_user_id: authUser.id,
    });
    return NextResponse.json(invite, { status: 201 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Vendor invitation delivery failed.';
    await markDelivery(admin, {
      invite_id: invite.invite.id,
      status: 'delivery_failed',
      error: message,
    }).catch(() => undefined);
    return jsonError(message, 502);
  }
}
