import '../sync/api_client.dart';

class PunchApi {
  final ApiClient _api;
  PunchApi(this._api);

  Future<Map<String, dynamic>> syncPunchEvents(List<Map<String, dynamic>> events) async {
    final resp = await _api.dio.post('/api/v1/punch-events/sync', data: {'events': events});
    return resp.data;
  }

  Future<List<dynamic>> getPunchHistory({
    required String workerId,
    String? dateFrom,
    String? dateTo,
  }) async {
    final params = <String, dynamic>{'worker_id': workerId};
    if (dateFrom != null) params['date_from'] = dateFrom;
    if (dateTo != null) params['date_to'] = dateTo;
    final resp = await _api.dio.get('/api/v1/punch-events', queryParameters: params);
    return resp.data;
  }
}
