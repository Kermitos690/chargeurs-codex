import { Link, useParams } from "react-router-dom";
import { PublicNav } from "@/components/public/PublicNav";
import { LiquidBackground } from "@/components/LiquidBackground";
import { formatChf, PUBLIC_PRICING } from "@/lib/publicPricing";

type LegalKind = "conditions" | "confidentialite" | "mentions-legales";

const TITLES: Record<LegalKind, string> = {
  conditions: "Conditions générales d'utilisation et de location",
  confidentialite: "Politique de confidentialité",
  "mentions-legales": "Mentions légales",
};

function Conditions() {
  return <>
    <h2>1. Service</h2><p>Chargeurs.ch permet de louer une batterie externe auprès d'une borne du réseau, puis de la restituer dans une borne compatible disposant d'un emplacement libre. La location ne devient active qu'après confirmation serveur du paiement et confirmation de la remise de la batterie.</p>
    <h2>2. Prix et garantie</h2><p>Le tarif de référence est de {formatChf(PUBLIC_PRICING.hourlyRate)} par heure, facturé par tranches de {PUBLIC_PRICING.incrementMinutes} minutes, avec un plafond de {formatChf(PUBLIC_PRICING.dailyCap)} par jour. Une garantie initiale de {formatChf(PUBLIC_PRICING.deposit)} est autorisée ou encaissée selon le moyen de paiement. Le prix définitif est calculé côté serveur au retour.</p>
    <h2>3. Retour et non-retour</h2><p>Le client doit insérer correctement la batterie dans un slot compatible et attendre la confirmation de retour. En cas de non-retour selon le délai indiqué lors de la location, le montant total peut atteindre {formatChf(PUBLIC_PRICING.nonReturnTotal)}, soit au maximum {formatChf(PUBLIC_PRICING.nonReturnBalanceAfterDeposit)} en complément de la garantie initiale.</p>
    <h2>4. Paiement</h2><p>Le paiement principal utilise Stripe Checkout sur le téléphone du client. Les moyens proposés dépendent du pays, du navigateur et de la configuration Stripe. Une page de succès ne constitue jamais, à elle seule, une preuve de paiement. Les remboursements après un échec de délivrance sont traités côté serveur et peuvent prendre le délai bancaire habituel.</p>
    <h2>5. Utilisation et responsabilité</h2><p>La batterie doit être utilisée avec un appareil compatible, conservée à l'abri de l'eau, de la chaleur et des chocs, et ne doit pas être ouverte ou modifiée. Tout incident doit être signalé rapidement avec l'identifiant de borne et le code public de location.</p>
    <h2>6. Support et contestation</h2><p>Le support est accessible depuis la page dédiée. Le client ne doit jamais transmettre un numéro de carte complet. Les présentes conditions devront être validées avec l'identité juridique définitive de l'exploitant avant l'ouverture publique.</p>
  </>;
}

function Privacy() {
  return <>
    <h2>1. Données traitées</h2><p>Selon le parcours utilisé : adresse email, profil client, consentements, identifiants techniques, historique de locations, paiements et remboursements, événements de borne, incidents, demandes de support et journaux de sécurité. Chargeurs.ch ne stocke pas les données complètes de carte bancaire.</p>
    <h2>2. Finalités</h2><p>Fournir la location, confirmer le paiement, piloter l'éjection et le retour, calculer le prix final, prévenir les abus, assister le client, maintenir les bornes, respecter les obligations comptables et assurer la sécurité du service.</p>
    <h2>3. Sous-traitants et destinataires</h2><p>Stripe traite les paiements ; Supabase héberge l'authentification, la base et les fonctions serveur ; l'hébergeur web sert l'interface ; ChargeNow reçoit uniquement les commandes nécessaires au matériel lorsque l'intégration est activée. Les accès internes sont limités par rôle et journalisés.</p>
    <h2>4. Conservation et sécurité</h2><p>Les durées dépendent de la finalité et des obligations légales suisses. Les secrets sont conservés côté serveur, les tokens kiosque sont hachés en base et les communications utilisent TLS. Les adresses IP des formulaires publics ne sont pas conservées en clair : seule une empreinte salée de limitation d'abus est stockée.</p>
    <h2>5. Vos droits</h2><p>Vous pouvez demander l'accès, la rectification, l'export ou la suppression des données qui ne doivent plus être conservées légalement. Connectez-vous à votre compte ou contactez support@chargeurs.ch. Une vérification d'identité peut être demandée.</p>
    <h2>6. Contact</h2><p>Responsable du traitement : Chargeurs.ch, coordonnées juridiques à compléter et valider avant production. Contact opérationnel : support@chargeurs.ch.</p>
  </>;
}

function LegalNotice() {
  return <>
    <h2>Exploitant</h2><p>Chargeurs.ch. La raison sociale, la forme juridique, l'adresse du siège, le numéro IDE/TVA et le représentant autorisé doivent être fournis par le propriétaire puis validés avant la mise en production.</p>
    <h2>Contact</h2><p>Email : support@chargeurs.ch. Les coordonnées téléphoniques et postales publiées doivent être confirmées par l'exploitant.</p>
    <h2>Hébergement et paiements</h2><p>L'application utilise Supabase pour les services de données et Stripe pour le paiement. L'hébergeur web de production et sa région seront inscrits ici après création des environnements staging et production.</p>
    <h2>Propriété intellectuelle</h2><p>La marque, les textes, les visuels et le logiciel Chargeurs.ch sont protégés selon leurs titulaires respectifs. Les composants tiers restent soumis à leurs licences.</p>
    <h2>État de publication</h2><p>Cette page est techniquement intégrée mais les informations juridiques signalées doivent être complétées et approuvées. L'ouverture au public est bloquée tant que cette validation n'est pas consignée dans la checklist de production.</p>
  </>;
}

export default function LegalPage() {
  const { kind } = useParams<{ kind: LegalKind }>();
  const selected: LegalKind = kind === "conditions" || kind === "confidentialite" || kind === "mentions-legales" ? kind : "mentions-legales";
  return (
    <div className="relative min-h-screen">
      <LiquidBackground /><PublicNav />
      <main className="mx-auto max-w-4xl px-6 pb-20 pt-32 sm:px-10">
        <article className="glass-strong liquid-border rounded-3xl p-8 sm:p-12">
          <p className="text-sm font-semibold text-primary">Chargeurs.ch · version du 19 juillet 2026</p>
          <h1 className="mt-3 font-display text-4xl font-extrabold">{TITLES[selected]}</h1>
          <div className="prose prose-invert mt-8 max-w-none prose-headings:font-display prose-p:text-muted-foreground">
            {selected === "conditions" ? <Conditions /> : selected === "confidentialite" ? <Privacy /> : <LegalNotice />}
          </div>
          <div className="mt-10 flex flex-wrap gap-4 text-sm font-semibold text-primary">
            <Link to="/legal/conditions">Conditions</Link><Link to="/legal/confidentialite">Confidentialité</Link><Link to="/legal/mentions-legales">Mentions légales</Link>
          </div>
        </article>
      </main>
    </div>
  );
}
