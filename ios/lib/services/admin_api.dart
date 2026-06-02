import 'package:dio/dio.dart';
import '../sync/api_client.dart';

class AdminApi {
  final ApiClient _api;
  AdminApi(this._api);

  Future<Map<String, dynamic>> signup({
    required String name,
    required String mobile,
    required String aadhar,
    String? faceTemplateId,
  }) async {
    final resp = await _api.dio.post('/api/v1/admin/signup', data: {
      'name': name,
      'mobile': mobile,
      'aadhar': aadhar,
      if (faceTemplateId != null) 'face_template_id': faceTemplateId,
    });
    return resp.data;
  }

  Future<Map<String, dynamic>> login({
    required String mobile,
    required String aadhar,
  }) async {
    final resp = await _api.dio.post('/api/v1/admin/login', data: {
      'mobile': mobile,
      'aadhar': aadhar,
    });
    return resp.data;
  }

  Future<List<dynamic>> getWorkers() async {
    final resp = await _api.dio.get('/api/v1/workers');
    return resp.data;
  }

  Future<Map<String, dynamic>> addWorker(Map<String, dynamic> data) async {
    final resp = await _api.dio.post('/api/v1/workers', data: data);
    return resp.data;
  }

  Future<void> deleteWorker(String id) async {
    await _api.dio.delete('/api/v1/workers/$id');
  }
}
