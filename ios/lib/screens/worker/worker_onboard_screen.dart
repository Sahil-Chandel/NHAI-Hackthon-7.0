import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../i18n/app_localizations.dart';
import '../../theme/app_theme.dart';
import '../../theme/colors.dart';
import '../../sync/api_client.dart';
import '../../services/session_store.dart';
import '../../storage/templates_repo.dart';

/// Datalake 3.0 worker self-onboarding (matches the Android flow):
/// First/Last/mobile/email -> POST /worker/verify -> "Verified from DataLake"
/// -> one-time face register (reuses EnrollmentScreen) -> POST /worker/register-face
/// -> commit session -> Punch screen.
class WorkerOnboardScreen extends StatefulWidget {
  const WorkerOnboardScreen({super.key});

  @override
  State<WorkerOnboardScreen> createState() => _WorkerOnboardScreenState();
}

enum _Step { form, verified, registering }

class _WorkerOnboardScreenState extends State<WorkerOnboardScreen> {
  final _formKey = GlobalKey<FormState>();
  final _firstName = TextEditingController();
  final _lastName = TextEditingController();
  final _mobile = TextEditingController();
  final _email = TextEditingController();

  final ApiClient _api = ApiClient();
  final TemplatesRepo _templatesRepo = TemplatesRepo();

  _Step _step = _Step.form;
  bool _loading = false;
  String? _error;

  // Onboarding context held after a successful verify.
  String? _token;
  int _expiresIn = 0;
  Map<String, dynamic>? _worker;
  String get _workerId => (_worker?['id'] ?? '').toString();
  String get _workerName => (_worker?['name'] ?? '').toString();

  @override
  void dispose() {
    _firstName.dispose();
    _lastName.dispose();
    _mobile.dispose();
    _email.dispose();
    super.dispose();
  }

  Future<void> _verify(AppLocalizations? loc) async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final resp = await _api.verifyWorker(
        firstName: _firstName.text.trim(),
        lastName: _lastName.text.trim(),
        mobile: _mobile.text.replaceAll(RegExp(r'\D'), ''),
        email: _email.text.trim(),
      );
      _token = resp['access_token'] as String?;
      _expiresIn = (resp['expires_in'] as num?)?.toInt() ?? 0;
      _worker = (resp['worker'] as Map).cast<String, dynamic>();
      if (_token != null) _api.setToken(_token!);
      if (mounted) setState(() => _step = _Step.verified);
    } on DioException catch (e) {
      final code = e.response?.statusCode;
      setState(() => _error = code == 404
          ? (loc?.t('worker_onboard.not_found') ??
              'Your details did not match the worker registry. Please check and try again.')
          : (loc?.t('worker_onboard.failed') ?? 'Verification failed'));
    } catch (_) {
      setState(() => _error = loc?.t('worker_onboard.failed') ?? 'Verification failed');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _registerFace(AppLocalizations? loc) async {
    final uuid = _workerId;
    if (uuid.isEmpty || _token == null) return;
    final localUserId = 'worker-$uuid';
    setState(() => _error = null);

    // Reuse the 3-angle EnrollmentScreen; it saves a local template under
    // userId=localUserId, then pops back here.
    await context.push(
      '/enroll?userId=${Uri.encodeComponent(localUserId)}'
      '&name=${Uri.encodeComponent(_workerName)}'
      '&purpose=worker_onboard',
    );
    if (!mounted) return;

    // Pull the embedding the enrollment just stored on-device.
    final templates = await _templatesRepo.getAllTemplates();
    final ours = templates.where((t) => t.userId == localUserId).toList();
    if (ours.isEmpty) {
      // User backed out of enrollment without finishing.
      setState(() => _error =
          loc?.t('worker_onboard.capture_failed') ?? 'Face capture failed. Please try again.');
      return;
    }
    final tmpl = ours.last;

    setState(() => _step = _Step.registering);
    try {
      try {
        await _api.registerFace(faceTemplateId: tmpl.id, embedding: tmpl.embedding);
      } on DioException catch (e) {
        // 409 = face already registered centrally (e.g. re-onboarding on a new
        // device). The on-device template just enrolled is what punch uses, so
        // it's safe to continue.
        if (e.response?.statusCode != 409) rethrow;
      }
      if (!mounted) return;
      await SessionStore().loginAsWorker(_token!, _expiresIn, _worker!);
      if (mounted) context.go('/worker/punch');
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = loc?.t('worker_onboard.reg_failed') ??
              'Could not save your face. Please try again.';
          _step = _Step.verified;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final loc = AppLocalizations.of(context);
    final isAAA = context.watch<ThemeNotifier>().isAAA;
    final colors = isAAA ? AppColors.aaa : AppColors.normal;

    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(
        backgroundColor: colors.bg,
        foregroundColor: colors.text,
        // Block leaving while a face is being saved + session committed.
        automaticallyImplyLeading: _step != _Step.registering,
        title: Text(loc?.t('worker_onboard.title') ?? 'Worker Login'),
        elevation: 0,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: _step == _Step.form
              ? _buildForm(colors, loc)
              : _step == _Step.verified
                  ? _buildVerified(colors, loc, isAAA)
                  : _buildRegistering(colors, loc),
        ),
      ),
    );
  }

  Widget _buildForm(dynamic colors, AppLocalizations? loc) {
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 8),
          const Center(child: Text('👷', style: TextStyle(fontSize: 56))),
          const SizedBox(height: 12),
          Text(
            loc?.t('worker_onboard.subtitle') ??
                'Enter your details to verify against the worker registry',
            textAlign: TextAlign.center,
            style: TextStyle(color: colors.textSecondary, fontSize: 14),
          ),
          const SizedBox(height: 24),
          _field(colors, _firstName, loc?.t('worker_onboard.first_label') ?? 'First Name',
              hint: loc?.t('worker_onboard.first_ph') ?? 'e.g. Rajesh', cap: true),
          const SizedBox(height: 16),
          _field(colors, _lastName, loc?.t('worker_onboard.last_label') ?? 'Last Name',
              hint: loc?.t('worker_onboard.last_ph') ?? 'e.g. Kumar', cap: true),
          const SizedBox(height: 16),
          _field(colors, _mobile, loc?.t('worker_onboard.mobile_label') ?? 'Mobile Number',
              hint: loc?.t('worker_onboard.mobile_ph') ?? '10-digit number',
              keyboard: TextInputType.phone, validator: (v) {
            final d = (v ?? '').replaceAll(RegExp(r'\D'), '');
            return d.length == 10
                ? null
                : (loc?.t('worker_onboard.err_mobile') ?? 'Enter a valid 10-digit mobile number');
          }),
          const SizedBox(height: 16),
          _field(colors, _email, loc?.t('worker_onboard.email_label') ?? 'Email',
              hint: loc?.t('worker_onboard.email_ph') ?? 'you@example.com',
              keyboard: TextInputType.emailAddress, validator: (v) {
            return RegExp(r'^\S+@\S+\.\S+$').hasMatch((v ?? '').trim())
                ? null
                : (loc?.t('worker_onboard.err_email') ?? 'Enter a valid email address');
          }),
          if (_error != null) ...[
            const SizedBox(height: 16),
            Text(_error!, textAlign: TextAlign.center, style: TextStyle(color: colors.danger)),
          ],
          const SizedBox(height: 28),
          ElevatedButton(
            onPressed: _loading ? null : () => _verify(loc),
            style: ElevatedButton.styleFrom(
              backgroundColor: colors.primary,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            child: _loading
                ? const SizedBox(
                    height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : Text(loc?.t('worker_onboard.btn') ?? 'Login & Continue',
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
  }

  Widget _field(dynamic colors, TextEditingController c, String label,
      {String? hint,
      TextInputType keyboard = TextInputType.text,
      bool cap = false,
      String? Function(String?)? validator}) {
    return TextFormField(
      controller: c,
      keyboardType: keyboard,
      textCapitalization: cap ? TextCapitalization.words : TextCapitalization.none,
      style: TextStyle(color: colors.text),
      decoration: InputDecoration(labelText: label, hintText: hint),
      validator: validator ??
          (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
    );
  }

  Widget _buildVerified(dynamic colors, AppLocalizations? loc, bool isAAA) {
    return Column(
      children: [
        const SizedBox(height: 24),
        Container(
          width: 72,
          height: 72,
          decoration: BoxDecoration(shape: BoxShape.circle, color: colors.success),
          child: Center(
            child: Text('✓',
                style: TextStyle(
                    fontSize: 40,
                    fontWeight: FontWeight.w900,
                    color: isAAA ? Colors.black : Colors.white)),
          ),
        ),
        const SizedBox(height: 12),
        Text(loc?.t('worker_onboard.verified') ?? 'Verified from DataLake',
            style: TextStyle(color: colors.success, fontSize: 20, fontWeight: FontWeight.w800)),
        const SizedBox(height: 4),
        Text(_workerName,
            style: TextStyle(color: colors.text, fontSize: 24, fontWeight: FontWeight.w900),
            textAlign: TextAlign.center),
        const SizedBox(height: 16),
        Text(
          loc?.t('worker_onboard.register_hint') ??
              'One-time step: register your face so you can punch in/out.',
          textAlign: TextAlign.center,
          style: TextStyle(color: colors.textSecondary, fontSize: 14),
        ),
        if (_error != null) ...[
          const SizedBox(height: 16),
          Text(_error!, textAlign: TextAlign.center, style: TextStyle(color: colors.danger)),
        ],
        const SizedBox(height: 28),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            onPressed: () => _registerFace(loc),
            style: ElevatedButton.styleFrom(
              backgroundColor: colors.primary,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            child: Text(loc?.t('worker_onboard.register_btn') ?? 'Register Your Face',
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          ),
        ),
      ],
    );
  }

  Widget _buildRegistering(dynamic colors, AppLocalizations? loc) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 80),
      child: Column(
        children: [
          CircularProgressIndicator(color: colors.primary),
          const SizedBox(height: 20),
          Text(loc?.t('worker_onboard.saving') ?? 'Saving your face securely...',
              style: TextStyle(color: colors.textSecondary, fontSize: 14)),
        ],
      ),
    );
  }
}
